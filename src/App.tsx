import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarPanel } from './components/CalendarPanel'
import { DayPanel } from './components/DayPanel'
import { RefsPanel } from './components/RefsPanel'
import { WeatherPanel } from './components/WeatherPanel'
import { getWriteToken, pullCloud, pullLegacyPublicMaps, setWriteToken } from './lib/cloud'
import { downloadCsv, downloadTextFile, mergeCsvIntoSchedule, readCsvText, scheduleToCsv } from './lib/csv'
import { scheduleToIcs } from './lib/ics'
import { ExtraBar } from './components/ExtraBar'
import { SourceBar } from './components/SourceBar'
import { UpdateBar } from './components/UpdateBar'
import { isNativeApp } from './lib/ota'
import { campusIsLive, getSyncSource, seedCampusLogin, type SyncSource } from './lib/origin'
import { addDays, addMonths, isAllDay, parseDateKey, timeSortKey, toDateKey, todayKey } from './lib/dates'
import { loadSchedule, saveSchedule, uid } from './lib/storage'
import { clearLegacyOverlay, slotKey } from './lib/sync'
import { coerceSchedule } from './lib/schedule'
import { unlockFromPublic } from './lib/unlock'
import { diffById } from './lib/ops/diff'
import { project } from './lib/ops/fold'
import { HlcClock } from './lib/ops/hlc'
import {
  enqueueOps,
  getOrCreateDeviceId,
  itemCount,
  loadQueue,
  loadSnapshotMap,
  makeDiffMeta,
  queueByteSize,
  saveQueue,
  saveSnapshotMap,
  syncClockFromQueue,
} from './lib/ops/queue'
import { flushOps, pullSnapshot } from './lib/ops/cloud'
import {
  createOpsFromPublicAhead,
  loadCatchupSeen,
  pendingCreateOrRestoreIds,
  pruneCatchupSeen,
  rememberCatchupSeen,
  unionSchedules,
} from './lib/ops/importPublic'
import type { ScheduleMap } from './types'

type SyncPhase = 'off' | 'pull' | 'push' | 'ok' | 'err'

export default function App() {
  const [cursor, setCursor] = useState(() => new Date())
  const [selectedKey, setSelectedKey] = useState(todayKey)
  const [schedule, setSchedule] = useState<ScheduleMap>(() => {
    const snap = loadSnapshotMap()
    const q = loadQueue()
    if (snap && q.queue.length > 0) return project(snap, q.queue)
    if (snap && itemCount(snap) > 0) return coerceSchedule(snap)
    return coerceSchedule(loadSchedule())
  })
  const [message, setMessage] = useState('正在加载…')
  const [pane, setPane] = useState<'calendar' | 'day' | 'weather' | 'refs'>('calendar')
  const [phrase, setPhrase] = useState('')
  const [askPhrase, setAskPhrase] = useState(false)
  const [unlocking, setUnlocking] = useState(false)
  const [unlockError, setUnlockError] = useState('')
  const [phase, setPhase] = useState<SyncPhase>('pull')
  const pushTimer = useRef(0)
  const flushBackoff = useRef(1000)
  const pendingRef = useRef<ScheduleMap | null>(null)
  const snapshotRef = useRef<ScheduleMap>(loadSnapshotMap() ?? {})
  const syncingRef = useRef(false)
  const editingRef = useRef(false)
  const deviceId = useRef(getOrCreateDeviceId())
  const clockRef = useRef(new HlcClock(deviceId.current))
  const csvInputRef = useRef<HTMLInputElement>(null)
  const csvTextRef = useRef('')
  const [csvSheet, setCsvSheet] = useState<{ title: string; text: string; mode: 'export' | 'import' } | null>(null)
  const [undo, setUndo] = useState<{ label: string; before: ScheduleMap } | null>(null)
  const [undoArmed, setUndoArmed] = useState(false)
  const [source, setSource] = useState<SyncSource>(() => getSyncSource())
  const pendingRemoteRef = useRef<ScheduleMap | null>(null)
  const applySnapshotRef = useRef<((map: ScheduleMap, rev?: number) => void) | undefined>(undefined)
  const focusPullAt = useRef(0)
  const today = useMemo(() => new Date(), [])

  useMemo(() => {
    syncClockFromQueue(clockRef.current, loadQueue())
  }, [])

  function clipTitle(title: string) {
    const t = title.trim()
    return t.length > 18 ? `${t.slice(0, 18)}…` : t
  }

  function cloneSchedule(map: ScheduleMap): ScheduleMap {
    return JSON.parse(JSON.stringify(map)) as ScheduleMap
  }

  function exportCsv() {
    const csv = scheduleToCsv(pendingRef.current ?? schedule)
    const stamp = toDateKey(new Date())
    const filename = `h2-schedule-${stamp}.csv`
    csvTextRef.current = csv
    void downloadCsv(filename, csv)
      .then((how) => {
        setPhase('ok')
        if (how === 'text') {
          setCsvSheet({ title: filename, text: csv, mode: 'export' })
          setMessage('WebView 不能直接存文件，请复制或分享下方文本')
          return
        }
        setMessage(how === 'share' ? '已打开系统分享，请存成文件' : '已导出 CSV')
      })
      .catch((e: unknown) => {
        setPhase('err')
        setCsvSheet({ title: filename, text: csv, mode: 'export' })
        setMessage(e instanceof Error ? e.message : '导出失败，可复制下方文本')
      })
  }

  function exportIcs() {
    const ics = scheduleToIcs(pendingRef.current ?? schedule)
    const stamp = toDateKey(new Date())
    const filename = `h2-schedule-${stamp}.ics`
    csvTextRef.current = ics
    void downloadTextFile(filename, ics, 'text/calendar;charset=utf-8')
      .then((how) => {
        setPhase('ok')
        if (how === 'text') {
          setCsvSheet({ title: filename, text: ics, mode: 'export' })
          setMessage('WebView 不能直接存文件，请复制或分享下方文本')
          return
        }
        setMessage(how === 'share' ? '已打开系统分享，请存成日历文件' : '已导出 ICS')
      })
      .catch((e: unknown) => {
        setPhase('err')
        setCsvSheet({ title: filename, text: ics, mode: 'export' })
        setMessage(e instanceof Error ? e.message : '导出失败，可复制下方文本')
      })
  }

  function applyCsvText(text: string) {
    const merged = mergeCsvIntoSchedule(pendingRef.current ?? schedule, text)
    commit(merged, `导入 CSV`)
    setCsvSheet(null)
    setMessage('已导入 CSV，正在同步…')
  }

  function importCsvFile(file: File) {
    void readCsvText(file)
      .then((text) => applyCsvText(text))
      .catch((e: unknown) => {
        setPhase('err')
        setMessage(e instanceof Error ? e.message : '导入失败')
      })
  }

  useEffect(() => {
    clearLegacyOverlay()
  }, [])

  useEffect(() => {
    if (phase !== 'ok') return
    const t = window.setTimeout(() => setPhase('off'), 1400)
    return () => window.clearTimeout(t)
  }, [phase])

  useEffect(() => {
    let stop = false

    function applySnapshot(map: ScheduleMap, rev?: number) {
      if (editingRef.current) {
        pendingRemoteRef.current = map
        return
      }
      snapshotRef.current = map
      saveSnapshotMap(map, rev)
      const q = loadQueue()
      const view = q.queue.length > 0 ? project(map, q.queue) : coerceSchedule(map)
      pendingRef.current = view
      if (!editingRef.current) {
        setSchedule(view)
        saveSchedule(view)
      }
    }

    /**
     * 公开面（CLab/docs）若有 snapshot 没有的 id，记成 create op 并入本机队列。
     * 不写别人的 op 文件；flush 仍只 append 本机 deviceId 分片。
     */
    async function catchUpPublicAhead(authority: ScheduleMap): Promise<number> {
      if (!getWriteToken()) return 0
      pruneCatchupSeen(authority)
      let faces: ScheduleMap[] = []
      try {
        faces = await pullLegacyPublicMaps()
      } catch {
        return 0
      }
      if (faces.length === 0) return 0
      const publicUnion = unionSchedules(faces)
      const q = loadQueue()
      const skip = new Set([...pendingCreateOrRestoreIds(q.queue), ...loadCatchupSeen()])
      const meta = makeDiffMeta(clockRef.current, q)
      const ops = createOpsFromPublicAhead(authority, publicUnion, meta, skip)
      if (ops.length === 0) return 0
      saveQueue(q)
      enqueueOps(ops)
      rememberCatchupSeen(
        ops.map((op) => (op.payload as { id?: string }).id).filter((id): id is string => !!id),
      )
      return ops.length
    }

    async function pullAndAlign() {
      if (stop || editingRef.current || syncingRef.current) return
      setPhase('pull')
      try {
        if (getWriteToken()) {
          const snap = await pullSnapshot()
          if (stop) return
          if (snap) {
            applySnapshot(snap.map, snap.rev)
            const imported = await catchUpPublicAhead(snap.map)
            if (stop) return
            if (imported > 0) {
              applySnapshot(snap.map, snap.rev)
              setPhase('ok')
              setMessage(`公开面多出 ${imported} 条，已记入同步队列`)
              return
            }
            setPhase('ok')
            setMessage(itemCount(snap.map) > 0 ? '已对齐数据仓' : '还没有日程')
            return
          }
        }
        // 无令牌或私有仓不可读：退回公开快照（只读）
        const remote = await pullCloud()
        if (stop) return
        if (remote) {
          applySnapshot(remote.map)
          setPhase('ok')
          setMessage(
            getWriteToken()
              ? '数据仓暂不可读，已用公开快照'
              : '已加载公开快照；输入口令可读写数据仓',
          )
          if (!getWriteToken()) setAskPhrase(true)
          return
        }
        const boot = coerceSchedule(pendingRef.current ?? loadSchedule())
        setPhase('ok')
        setMessage(itemCount(boot) > 0 ? '已用本机日程' : '还没有日程')
      } catch (err) {
        const local = coerceSchedule(pendingRef.current ?? loadSchedule())
        if (itemCount(local) > 0) {
          setPhase('ok')
          setMessage(campusIsLive() ? '暂不通，先用本机（未丢）' : '网络暂不通，先用本机（未丢）')
          return
        }
        setPhase('err')
        setMessage(err instanceof Error ? err.message : '加载失败')
      }
    }

    async function flushQueue() {
      if (stop || editingRef.current) return
      const q = loadQueue()
      if (q.queue.length === 0) return
      if (!getWriteToken()) {
        setAskPhrase(true)
        setPhase('ok')
        setMessage('改动已记下，输入口令后即可同步到数据仓')
        return
      }
      if (syncingRef.current) return
      syncingRef.current = true
      setPhase('push')
      try {
        await flushOps()
        flushBackoff.current = 1000
        setAskPhrase(false)
        setPhase('ok')
        setMessage('已写入数据仓（op）')
        // 写完拉一次快照（reducer 可能尚未跑完，本地 project 仍正确）
        await pullAndAlign()
      } catch (err) {
        const text = err instanceof Error ? err.message : '同步失败'
        if (text.includes('口令') || text.includes('权限') || text.includes('令牌')) {
          setAskPhrase(true)
          setPhase('ok')
          setMessage('需要口令才能同步（本机改动已保留）')
          return
        }
        setPhase('ok')
        setMessage(`${text}（本机改动已保留）`)
        const delay = flushBackoff.current
        flushBackoff.current = Math.min(delay * 2, 60_000)
        window.setTimeout(() => {
          if (!stop && loadQueue().queue.length > 0) void flushQueue()
        }, delay)
      } finally {
        syncingRef.current = false
      }
    }

    applySnapshotRef.current = applySnapshot

    async function hydrate() {
      seedCampusLogin()
      const boot = coerceSchedule(pendingRef.current ?? loadSchedule())
      if (!editingRef.current && itemCount(boot) > 0) {
        setSchedule(boot)
        saveSchedule(boot)
      }
      await pullAndAlign()
      await flushQueue()
    }

    void hydrate()

    function onVisibility() {
      if (document.visibilityState !== 'visible' || stop) return
      void flushQueue().then(() => pullAndAlign())
    }
    function onOnline() {
      if (stop) return
      void flushQueue()
    }
    function onFocus() {
      if (stop) return
      const now = Date.now()
      if (now - focusPullAt.current < 5000) return
      focusPullAt.current = now
      void pullAndAlign()
    }

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('online', onOnline)
    window.addEventListener('focus', onFocus)

    return () => {
      stop = true
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('focus', onFocus)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once
  }, [])

  function flush() {
    if (editingRef.current) {
      window.clearTimeout(pushTimer.current)
      pushTimer.current = window.setTimeout(() => flush(), 800)
      return
    }
    const q = loadQueue()
    if (q.queue.length === 0) return
    if (!getWriteToken()) {
      setAskPhrase(true)
      setPhase('ok')
      setMessage('改动已记下，输入口令后即可同步到数据仓')
      return
    }
    if (syncingRef.current) return
    syncingRef.current = true
    setPhase('push')
    void flushOps()
      .then(async () => {
        flushBackoff.current = 1000
        setAskPhrase(false)
        setPhase('ok')
        setMessage('已写入数据仓（op）')
        try {
          const snap = await pullSnapshot()
          if (snap) {
            snapshotRef.current = snap.map
            saveSnapshotMap(snap.map, snap.rev)
            const view = project(snap.map, loadQueue().queue)
            pendingRef.current = view
            if (!editingRef.current) {
              setSchedule(view)
              saveSchedule(view)
            }
          }
        } catch {
          /* keep local projection */
        }
      })
      .catch((err: unknown) => {
        const text = err instanceof Error ? err.message : '同步失败'
        if (text.includes('口令') || text.includes('权限') || text.includes('令牌')) {
          setAskPhrase(true)
          setPhase('ok')
          setMessage('需要口令才能同步（本机改动已保留）')
          return
        }
        setPhase('ok')
        setMessage(`${text}（本机改动已保留）`)
      })
      .finally(() => {
        syncingRef.current = false
      })
  }

  function commit(next: ScheduleMap, label?: string, silent = false) {
    const prev = cloneSchedule(pendingRef.current ?? schedule)
    const clean = coerceSchedule(next)
    const qState = loadQueue()
    const meta = makeDiffMeta(clockRef.current, qState)
    const ops = diffById(prev, clean, meta)
    if (ops.length > 0) {
      if (qState.queue.length + ops.length > 500 || queueByteSize(qState) > 2_000_000) {
        setPhase('err')
        setMessage('离线改动过多，请先联网同步再继续编辑')
        return
      }
      saveQueue(qState) // persist nextSeq / clock side effects from meta
      enqueueOps(ops)
    }
    pendingRef.current = clean
    setSchedule(clean)
    saveSchedule(clean)
    if (!silent && label) {
      setUndo({ label, before: prev })
      setUndoArmed(false)
    }
    window.clearTimeout(pushTimer.current)
    const later = () => {
      if (editingRef.current) {
        pushTimer.current = window.setTimeout(later, 800)
        return
      }
      flush()
    }
    pushTimer.current = window.setTimeout(later, 400)
  }

  function commitFrom(mutator: (map: ScheduleMap) => ScheduleMap, label?: string) {
    commit(mutator(pendingRef.current ?? schedule), label)
  }

  function runUndo() {
    if (!undo) return
    if (!undoArmed) {
      setUndoArmed(true)
      return
    }
    const label = undo.label
    const before = undo.before
    setUndo(null)
    setUndoArmed(false)
    commit(before, undefined, true)
    setMessage(`已撤销「${label}」`)
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z' || e.shiftKey) return
      const t = e.target as HTMLElement | null
      if (t?.closest('input, textarea, select, [contenteditable="true"]')) return
      if (!undo || editingRef.current) return
      e.preventDefault()
      runUndo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, undoArmed])

  function patchSelectedDay(
    updater: (list: NonNullable<ScheduleMap[string]>) => NonNullable<ScheduleMap[string]>,
    label?: string,
  ) {
    commitFrom((map) => {
      const next = { ...map }
      const list = updater(next[selectedKey] ?? [])
      if (list.length === 0) delete next[selectedKey]
      else next[selectedKey] = list
      return next
    }, label)
  }

  const selected = parseDateKey(selectedKey)
  // 只显示 date 字段确实是当天的——桶串了也不让「改过的第一条」挂到别的天
  const items = [...(schedule[selectedKey] ?? [])]
    .filter((item) => item.date === selectedKey)
    .sort((a, b) => {
      const ad = isAllDay(a)
      const bd = isAllDay(b)
      if (ad !== bd) return ad ? 1 : -1
      const ta = timeSortKey(a)
      const tb = timeSortKey(b)
      if (ta !== tb) return ta.localeCompare(tb)
      if (a.kind !== b.kind) return a.kind === 'deadline' ? -1 : 1
      return a.title.localeCompare(b.title, 'zh')
    })

  return (
    <div className="app">
      <div
        className={`sync-progress ${phase}`}
        role="progressbar"
        aria-label={
          phase === 'pull' ? '正在读取' : phase === 'push' ? '正在保存' : phase === 'err' ? '同步出错' : '同步'
        }
        aria-busy={phase === 'pull' || phase === 'push'}
      >
        <i />
      </div>
      <header className="topbar">
        <div className="brand">
          <span className="brand-kicker">日程</span>
          <h1>H2 Schedule</h1>
        </div>
        <div className="top-actions">
          <SourceBar
            value={source}
            onChange={(next) => {
              setSource(next)
              window.location.reload()
            }}
          />
          {isNativeApp() ? <UpdateBar /> : null}
          <ExtraBar
            onExportCsv={exportCsv}
            onExportIcs={exportIcs}
            onImportFile={() => csvInputRef.current?.click()}
            onPasteImport={() => setCsvSheet({ title: '粘贴 CSV', text: '', mode: 'import' })}
          />
          <button
            type="button"
            className="ghost"
            onClick={() => {
              const now = new Date()
              setCursor(now)
              setSelectedKey(toDateKey(now))
              setPane('day')
            }}
          >
            今天
          </button>
        </div>
      </header>
      <input
        ref={csvInputRef}
        type="file"
        accept=".csv,text/csv,text/plain,*/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) importCsvFile(f)
        }}
      />
      <nav className="mobile-tabs" aria-label="视图切换">
        <button
          type="button"
          className={pane === 'calendar' ? 'on' : ''}
          aria-pressed={pane === 'calendar'}
          onClick={() => setPane('calendar')}
        >
          月历
        </button>
        <button
          type="button"
          className={pane === 'day' ? 'on' : ''}
          aria-pressed={pane === 'day'}
          onClick={() => setPane('day')}
        >
          当日
        </button>
        <button
          type="button"
          className={pane === 'weather' ? 'on' : ''}
          aria-pressed={pane === 'weather'}
          onClick={() => setPane('weather')}
        >
          天气
        </button>
        <button
          type="button"
          className={pane === 'refs' ? 'on' : ''}
          aria-pressed={pane === 'refs'}
          onClick={() => setPane('refs')}
        >
          资料
        </button>
      </nav>
      <nav className="desk-tabs" aria-label="页面">
        <button type="button" className={pane === 'calendar' || pane === 'day' ? 'on' : ''} onClick={() => setPane('calendar')}>
          日程
        </button>
        <button type="button" className={pane === 'weather' ? 'on' : ''} onClick={() => setPane('weather')}>
          天气
        </button>
        <button type="button" className={pane === 'refs' ? 'on' : ''} onClick={() => setPane('refs')}>
          资料
        </button>
      </nav>
      <div className={`layout pane-${pane}`}>
        {pane === 'weather' ? (
          <WeatherPanel />
        ) : pane === 'refs' ? (
          <RefsPanel />
        ) : (
          <>
            <CalendarPanel
              view={cursor}
              selected={selected}
              today={today}
              schedule={schedule}
              onSelect={(d) => {
                setSelectedKey(toDateKey(d))
                setCursor(new Date(d.getFullYear(), d.getMonth(), 1))
                setPane('day')
              }}
              onPrev={() => setCursor((d) => addMonths(d, -1))}
              onNext={() => setCursor((d) => addMonths(d, 1))}
            />
            <DayPanel
              key={selectedKey}
              date={selected}
              items={items}
              undoLabel={undo?.label ?? null}
              undoArmed={undoArmed}
              onUndo={runUndo}
              onEditorOpenChange={(open) => {
                editingRef.current = open
                document.body.classList.toggle('h2-editing', open)
                if (!open) {
                  const q = pendingRemoteRef.current
                  if (q) {
                    window.setTimeout(() => {
                      if (editingRef.current) return
                      pendingRemoteRef.current = null
                      applySnapshotRef.current?.(q)
                    }, 400)
                  }
                }
              }}
              onPrevDay={() => {
                setSelectedKey((k) => {
                  const d = addDays(parseDateKey(k), -1)
                  setCursor(new Date(d.getFullYear(), d.getMonth(), 1))
                  return toDateKey(d)
                })
                setPane('day')
              }}
              onNextDay={() => {
                setSelectedKey((k) => {
                  const d = addDays(parseDateKey(k), 1)
                  setCursor(new Date(d.getFullYear(), d.getMonth(), 1))
                  return toDateKey(d)
                })
                setPane('day')
              }}
              onToggle={(item) => {
                const label = item.done ? `标为未完成 ${clipTitle(item.title)}` : `勾完 ${clipTitle(item.title)}`
                patchSelectedDay((list) => {
                  const hit = list.findIndex((row) => row === item)
                  const i =
                    hit >= 0
                      ? hit
                      : list.findIndex((row) => slotKey(row) === slotKey(item))
                  if (i < 0) return list
                  return list.map((row, idx) =>
                    idx === i ? { ...row, done: !row.done } : row,
                  )
                }, label)
              }}
              onRemove={(item) => {
                patchSelectedDay((list) => {
                  const hit = list.findIndex((row) => row === item)
                  if (hit >= 0) return list.filter((_, idx) => idx !== hit)
                  const k = slotKey(item)
                  let once = false
                  return list.filter((row) => {
                    if (slotKey(row) !== k) return true
                    if (once) return true
                    once = true
                    return false
                  })
                }, `删除 ${clipTitle(item.title)}`)
              }}
              onAdd={(draft) => {
                commitFrom(
                  (map) => ({
                    ...map,
                    [selectedKey]: [
                      ...(map[selectedKey] ?? []),
                      {
                        id: uid(),
                        date: selectedKey,
                        title: draft.title,
                        done: false,
                        kind: draft.kind,
                        allDay: draft.allDay || undefined,
                        start: draft.allDay ? undefined : draft.start || undefined,
                        end: draft.allDay ? undefined : draft.end || undefined,
                      },
                    ],
                  }),
                  `添加 ${clipTitle(draft.title)}`,
                )
              }}
              onUpdate={(item, draft) => {
                patchSelectedDay((list) => {
                  const hit = list.findIndex((row) => row === item)
                  const i =
                    hit >= 0
                      ? hit
                      : list.findIndex((row) => slotKey(row) === slotKey(item))
                  if (i < 0) return list
                  return list.map((row, idx) =>
                    idx === i
                      ? {
                          ...row,
                          date: selectedKey,
                          title: draft.title,
                          kind: draft.kind,
                          allDay: draft.allDay || undefined,
                          start: draft.allDay ? undefined : draft.start || undefined,
                          end: draft.allDay ? undefined : draft.end || undefined,
                        }
                      : row,
                  )
                }, `修改 ${clipTitle(item.title)}`)
              }}
            />
          </>
        )}
      </div>
      {pane === 'weather' || pane === 'refs' ? (
        undo || message ? (
          <div className="app-dock">
            {undo ? (
              <button
                type="button"
                className={`undo-bar${undoArmed ? ' armed' : ''}`}
                onClick={runUndo}
              >
                {undoArmed ? `确定撤销「${undo.label}」` : `撤销「${undo.label}」`}
              </button>
            ) : null}
            {message ? <div className="toast">{message}</div> : null}
          </div>
        ) : null
      ) : message ? (
        <div className="app-dock">
          <div className="toast">{message}</div>
        </div>
      ) : null}
      {askPhrase ? (
        <div className="sync-scrim">
          <form
            className="sync-card"
            onSubmit={(e) => {
              e.preventDefault()
              const p = phrase.trim()
              if (!p) {
                setUnlockError('还没填口令')
                return
              }
              setUnlockError('')
              setUnlocking(true)
              window.setTimeout(() => {
                void unlockFromPublic(p)
                  .then((token) => {
                    setWriteToken(token)
                    setPhrase('')
                    setAskPhrase(false)
                    setUnlocking(false)
                    setUnlockError('')
                    setMessage('口令正确，正在同步…')
                    flush()
                  })
                  .catch((err: unknown) => {
                    setUnlocking(false)
                    setUnlockError(err instanceof Error ? err.message : '同步失败')
                    setPhase('err')
                    setMessage('同步失败（本机改动已保留）')
                  })
              }, 50)
            }}
          >
            <h2>同步口令</h2>
            <p>手机和电脑用同一句口令。确认后稍等片刻即可。</p>
            <label htmlFor="sync-phrase">口令</label>
            <input
              id="sync-phrase"
              type="password"
              autoComplete="current-password"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              value={phrase}
              disabled={unlocking}
              onChange={(e) => setPhrase(e.target.value)}
            />
            {unlockError ? <p className="unlock-error">{unlockError}</p> : null}
            <div className="sync-actions">
              <button className="solid" type="submit" disabled={unlocking}>
                {unlocking ? '同步中…' : '确认并同步'}
              </button>
              <button
                className="ghost"
                type="button"
                disabled={unlocking}
                onClick={() => setAskPhrase(false)}
              >
                先留在本机
              </button>
            </div>
          </form>
        </div>
      ) : null}
      {csvSheet ? (
        <div className="sync-scrim" onClick={() => setCsvSheet(null)}>
          <form
            className="sync-card csv-sheet"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault()
              if (csvSheet.mode === 'import') {
                try {
                  applyCsvText(csvSheet.text)
                } catch (err) {
                  setPhase('err')
                  setMessage(err instanceof Error ? err.message : '导入失败')
                }
              } else {
                setCsvSheet(null)
              }
            }}
          >
            <h2>{csvSheet.mode === 'import' ? '粘贴 CSV' : '导出文本'}</h2>
            <p>
              {csvSheet.mode === 'import'
                ? '把电脑导出的 CSV 整段贴进来。也认 time 列或中文表头。'
                : '选中下方全部内容，复制后发到电脑或存成 .csv 文件。'}
            </p>
            <textarea
              className="csv-textarea"
              value={csvSheet.text}
              readOnly={csvSheet.mode === 'export'}
              onChange={(e) => setCsvSheet({ ...csvSheet, text: e.target.value })}
              rows={12}
              spellCheck={false}
            />
            <div className="sync-actions">
              {csvSheet.mode === 'export' ? (
                <button
                  className="solid"
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(csvSheet.text).then(
                      () => {
                        setMessage('已复制')
                        setPhase('ok')
                      },
                      () => setMessage('请长按文本手动复制'),
                    )
                  }}
                >
                  复制全部
                </button>
              ) : (
                <button className="solid" type="submit">
                  导入
                </button>
              )}
              <button className="ghost" type="button" onClick={() => setCsvSheet(null)}>
                关闭
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  )
}
