import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarPanel } from './components/CalendarPanel'
import { DayPanel } from './components/DayPanel'
import { RefsPanel } from './components/RefsPanel'
import { WeatherPanel } from './components/WeatherPanel'
import { getWriteToken, pullCloud, pushCloud, setWriteToken } from './lib/cloud'
import { downloadCsv, mergeCsvIntoSchedule, scheduleToCsv } from './lib/csv'
import { addDays, addMonths, isAllDay, parseDateKey, timeSortKey, toDateKey, todayKey } from './lib/dates'
import { flattenItems } from './lib/backup'
import { loadSchedule, saveSchedule, uid } from './lib/storage'
import {
  clearLegacyOverlay,
  integrateSchedules,
  isPendingSync,
  loadRemoteSha,
  loadRemoteSnap,
  mergeByIdentity,
  normalizeSchedule,
  saveRemoteSha,
  saveRemoteSnap,
  scheduleContentSig,
  setPendingSync,
} from './lib/sync'
import { unlockFromPublic } from './lib/unlock'
import { UpdateBar } from './components/UpdateBar'
import type { ScheduleMap } from './types'

type SyncPhase = 'off' | 'pull' | 'push' | 'ok' | 'err'

export default function App() {
  const [cursor, setCursor] = useState(() => new Date())
  const [selectedKey, setSelectedKey] = useState(todayKey)
  const [schedule, setSchedule] = useState<ScheduleMap>(() => normalizeSchedule(loadSchedule()))
  const [message, setMessage] = useState('正在加载…')
  const [pane, setPane] = useState<'calendar' | 'day' | 'weather' | 'refs'>('calendar')
  const [phrase, setPhrase] = useState('')
  const [askPhrase, setAskPhrase] = useState(false)
  const [unlocking, setUnlocking] = useState(false)
  const [unlockError, setUnlockError] = useState('')
  const [phase, setPhase] = useState<SyncPhase>('pull')
  const shaRef = useRef(loadRemoteSha())
  const pushTimer = useRef(0)
  const dirtyRef = useRef(isPendingSync())
  const pendingRef = useRef<ScheduleMap | null>(null)
  const remoteRef = useRef<ScheduleMap>(loadRemoteSnap() ?? {})
  const syncingRef = useRef(false)
  const editingRef = useRef(false)
  const csvInputRef = useRef<HTMLInputElement>(null)
  const today = useMemo(() => new Date(), [])

  function exportCsv() {
    const csv = scheduleToCsv(schedule)
    const stamp = toDateKey(new Date())
    void downloadCsv(`h2-schedule-${stamp}.csv`, csv)
      .then((how) => {
        setPhase('ok')
        setMessage(how === 'clipboard' ? '已复制 CSV，可粘贴到文件' : how === 'share' ? '已打开系统分享，请存成文件' : '已导出 CSV')
      })
      .catch((e: unknown) => {
        setPhase('err')
        setMessage(e instanceof Error ? e.message : '导出失败')
      })
  }

  function importCsvFile(file: File) {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const text = String(reader.result || '')
        const merged = mergeCsvIntoSchedule(schedule, text)
        commit(merged)
        setMessage('已导入 CSV，正在同步…')
      } catch (e) {
        setPhase('err')
        setMessage(e instanceof Error ? e.message : '导入失败')
      }
    }
    reader.onerror = () => {
      setPhase('err')
      setMessage('读文件失败')
    }
    reader.readAsText(file, 'UTF-8')
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

    function adoptRemote(map: ScheduleMap, sha?: string) {
      remoteRef.current = map
      saveRemoteSnap(map)
      if (sha) {
        shaRef.current = sha
        saveRemoteSha(sha)
      }
    }

    /**
     * 拉/轮询统一入口。
     * 致命坑：绝不能先把 remoteRef 设成「本次新远端」再当 baseline——
     * pending 时会把远端条目全当成「本机已删」丢掉，再 flush 冲垮云端。
     */
    function applyRemote(remote: { map: ScheduleMap; sha: string }, reason: 'hydrate' | 'poll') {
      const prevBaseline = remoteRef.current
      const local = normalizeSchedule(loadSchedule())
      const localN = flattenItems(local).length
      const remoteN = flattenItems(normalizeSchedule(remote.map)).length
      const remoteByIdDate = new Map(
        flattenItems(normalizeSchedule(remote.map)).map((i) => [`${i.date}|${i.id}`, i]),
      )
      const titleEdited = flattenItems(local).some((l) => {
        const r = remoteByIdDate.get(`${l.date}|${l.id}`)
        return !!r && r.title.trim() !== l.title.trim()
      })

      // 本机空/极少时绝不能 preferLocal；改过标题时必须 preferLocal，否则云端化安会盖掉手写
      const wantPending = localN > 0 && (dirtyRef.current || isPendingSync() || titleEdited)
      const { merged, remoteClean, needPush } = integrateSchedules(remote.map, local, {
        pending: wantPending,
        baseline: wantPending ? prevBaseline : null,
      })
      const mergedN = flattenItems(merged).length

      // 护栏：合并结果比云端少一半以上 → 信任云端，拒绝写回稀薄本机
      if (remoteN >= 80 && mergedN < remoteN * 0.5) {
        adoptRemote(remoteClean, remote.sha || undefined)
        setSchedule(remoteClean)
        saveSchedule(remoteClean)
        dirtyRef.current = false
        pendingRef.current = null
        setPendingSync(false)
        if (reason === 'hydrate') {
          setPhase('ok')
          setMessage(`本机日程异常偏少（${mergedN}/${remoteN}），已改用云端`)
        }
        return false
      }

      adoptRemote(remoteClean, remote.sha || undefined)
      setSchedule(merged)
      saveSchedule(merged)

      if (needPush && localN > 0) {
        pendingRef.current = merged
        dirtyRef.current = true
        setPendingSync(true)
        if (getWriteToken()) {
          if (reason === 'hydrate') setMessage('正在对齐本机与云端…')
          flush(merged)
        } else if (reason === 'hydrate') {
          setAskPhrase(true)
          setPhase('ok')
          setMessage('日程已加载；输入口令可把本机改动同步上去')
        }
        return true
      }

      // 已与云端内容一致：清掉假 pending，否则轮询永远停、越积越脏
      dirtyRef.current = false
      pendingRef.current = null
      setPendingSync(false)
      return false
    }

    async function hydrate() {
      setPhase('pull')
      try {
        // 只 normalize，不要对空远端做 integrate（会把全部本机标成 pending）
        const boot = normalizeSchedule(loadSchedule())
        saveSchedule(boot)
        if (flattenItems(boot).length > 0) setSchedule(boot)

        const remote = await pullCloud()
        if (stop) return
        if (!remote) {
          setMessage(flattenItems(boot).length > 0 ? '已用本机日程' : '还没有日程')
          setPhase('ok')
          return
        }

        const pending = applyRemote(remote, 'hydrate')
        if (!pending) {
          const n = flattenItems(normalizeSchedule(loadSchedule())).length
          setMessage(n > 0 ? '加载完毕' : '还没有日程')
          setPhase('ok')
        }
      } catch (err) {
        const local = normalizeSchedule(loadSchedule())
        if (flattenItems(local).length > 0) {
          setSchedule(local)
          saveSchedule(local)
          setPhase('ok')
          setMessage('云端暂不通，先用本机（未丢）')
          return
        }
        setPhase('err')
        setMessage(err instanceof Error ? err.message : '加载失败')
      }
    }

    void hydrate()

    const tick = window.setInterval(() => {
      // 编辑中/待推送/正在同步：不拉，避免重渲染冲掉编辑框或抢写
      if (dirtyRef.current || isPendingSync() || syncingRef.current || editingRef.current) return
      void pullCloud()
        .then((remote) => {
          if (!remote || dirtyRef.current || isPendingSync() || editingRef.current || stop) return
          // 无 sha = 多半是 Pages 缓存；已有 API sha 时不要用旧 Pages 盖掉刚改的标题
          if (!remote.sha && shaRef.current) return
          if (remote.sha && remote.sha === shaRef.current) return
          applyRemote(remote, 'poll')
        })
        .catch(() => {})
    }, 8000)

    return () => {
      stop = true
      window.clearInterval(tick)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once
  }, [])

  function flush(map: ScheduleMap) {
    const clean = normalizeSchedule(map)
    dirtyRef.current = true
    setPendingSync(true)
    pendingRef.current = clean
    saveSchedule(clean)

    if (!getWriteToken()) {
      setAskPhrase(true)
      setPhase('ok')
      setMessage('改动已记下，输入口令后即可同步')
      return
    }
    if (syncingRef.current) return
    syncingRef.current = true
    setPhase('push')
    void pushCloud(clean, shaRef.current)
      .then((sha) => {
        shaRef.current = sha
        saveRemoteSha(sha)
        remoteRef.current = clean
        saveRemoteSnap(clean)
        setAskPhrase(false)
        setPhase('ok')
        setMessage('已同步')
        // 推送期间又改过：不要用旧包盖掉新改动
        const later = pendingRef.current
        if (later && scheduleContentSig(later) !== scheduleContentSig(clean)) {
          setSchedule(later)
          saveSchedule(later)
          return
        }
        dirtyRef.current = false
        pendingRef.current = null
        setPendingSync(false)
        setSchedule(clean)
        saveSchedule(clean)
      })
      .catch(async (err) => {
        const text = err instanceof Error ? err.message : '同步失败'
        if (text.includes('令牌') || text.includes('口令')) {
          setAskPhrase(true)
          setPhase('ok')
          setMessage('需要口令才能同步（本机改动已保留）')
          return
        }
        if (text === '冲突') {
          try {
            const remote = await pullCloud()
            if (remote) {
              const latest = pendingRef.current ?? clean
              const aligned = normalizeSchedule(mergeByIdentity(remote.map, latest, true, null))
              shaRef.current = remote.sha
              saveRemoteSha(remote.sha)
              remoteRef.current = aligned
              saveRemoteSnap(aligned)
              const sha = await pushCloud(aligned, remote.sha)
              shaRef.current = sha
              saveRemoteSha(sha)
              remoteRef.current = aligned
              saveRemoteSnap(aligned)
              const later = pendingRef.current
              if (later && scheduleContentSig(later) !== scheduleContentSig(aligned)) {
                setSchedule(later)
                saveSchedule(later)
                setPhase('ok')
                setMessage('已同步，还有本地改动…')
                return
              }
              dirtyRef.current = false
              pendingRef.current = null
              setPendingSync(false)
              setSchedule(aligned)
              saveSchedule(aligned)
              setPhase('ok')
              setMessage('已同步')
              return
            }
          } catch {
            /* fall through */
          }
        }
        setPhase('ok')
        setMessage(`${text}（本机改动已保留，稍后再试）`)
      })
      .finally(() => {
        syncingRef.current = false
        const later = pendingRef.current
        // 仅当推送成功后仍有「更新的本机」才续推；失败立刻重试会把拒绝覆盖打成死循环
        if (
          dirtyRef.current &&
          later &&
          getWriteToken() &&
          scheduleContentSig(later) !== scheduleContentSig(clean)
        ) {
          window.setTimeout(() => {
            if (dirtyRef.current && pendingRef.current && !syncingRef.current) {
              flush(pendingRef.current)
            }
          }, 50)
        }
      })
  }

  function commit(next: ScheduleMap) {
    const clean = normalizeSchedule(next)
    dirtyRef.current = true
    setPendingSync(true)
    pendingRef.current = clean
    setSchedule(clean)
    saveSchedule(clean)
    window.clearTimeout(pushTimer.current)
    pushTimer.current = window.setTimeout(() => flush(clean), 400)
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
          <UpdateBar />
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
      <div className="csv-bar" role="group" aria-label="CSV 同步">
        <button type="button" className="solid csv-btn" onClick={exportCsv}>
          导出 CSV
        </button>
        <button type="button" className="solid csv-btn" onClick={() => csvInputRef.current?.click()}>
          导入 CSV
        </button>
        <input
          ref={csvInputRef}
          type="file"
          accept=".csv,text/csv"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) importCsvFile(f)
          }}
        />
        <span className="csv-hint">手机电脑互拷日程</span>
      </div>
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
              onEditorOpenChange={(open) => {
                editingRef.current = open
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
              onToggle={(id) => {
                const list = (schedule[selectedKey] ?? []).map((item) =>
                  item.id === id && item.date === selectedKey
                    ? { ...item, done: !item.done }
                    : item,
                )
                commit({ ...schedule, [selectedKey]: list })
              }}
              onRemove={(id) => {
                const list = (schedule[selectedKey] ?? []).filter(
                  (item) => !(item.id === id && item.date === selectedKey),
                )
                const next = { ...schedule }
                if (list.length === 0) delete next[selectedKey]
                else next[selectedKey] = list
                commit(next)
              }}
              onAdd={(draft) => {
                commit({
                  ...schedule,
                  [selectedKey]: [
                    ...(schedule[selectedKey] ?? []),
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
                })
              }}
              onUpdate={(id, draft) => {
                let replaced = false
                const list = (schedule[selectedKey] ?? []).map((item) => {
                  if (replaced || item.id !== id || item.date !== selectedKey) return item
                  replaced = true
                  return {
                    ...item,
                    date: selectedKey,
                    title: draft.title,
                    kind: draft.kind,
                    allDay: draft.allDay || undefined,
                    start: draft.allDay ? undefined : draft.start || undefined,
                    end: draft.allDay ? undefined : draft.end || undefined,
                  }
                })
                commit({ ...schedule, [selectedKey]: list })
              }}
            />
          </>
        )}
      </div>
      {message ? <div className="toast">{message}</div> : null}
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
                const map = normalizeSchedule(pendingRef.current ?? schedule)
                void unlockFromPublic(p)
                  .then((token) => {
                    setWriteToken(token)
                    setPhrase('')
                    setMessage('口令正确，正在同步…')
                    return pushCloud(map, shaRef.current)
                  })
                  .then((sha) => {
                    shaRef.current = sha
                    saveRemoteSha(sha)
                    remoteRef.current = map
                    saveRemoteSnap(map)
                    setAskPhrase(false)
                    setUnlocking(false)
                    setPhase('ok')
                    const later = pendingRef.current
                    if (later && scheduleContentSig(later) !== scheduleContentSig(map)) {
                      setSchedule(later)
                      saveSchedule(later)
                      setMessage('已同步，正在写入后续改动…')
                      flush(later)
                      return
                    }
                    dirtyRef.current = false
                    pendingRef.current = null
                    setPendingSync(false)
                    setSchedule(map)
                    saveSchedule(map)
                    setMessage('已同步')
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
    </div>
  )
}
