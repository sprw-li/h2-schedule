import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarPanel } from './components/CalendarPanel'
import { DayPanel } from './components/DayPanel'
import { fingerprint } from './lib/backup'
import { getWriteToken, pullCloud, pushCloud, setWriteToken } from './lib/cloud'
import { addDays, addMonths, parseDateKey, timeSortKey, toDateKey, todayKey } from './lib/dates'
import { applyOverlay, emptyOverlay, loadOverlay, overlayBusy, saveOverlay } from './lib/overlay'
import { uid } from './lib/storage'
import { unlockFromPublic } from './lib/unlock'
import type { ScheduleMap } from './types'

type SyncPhase = 'off' | 'pull' | 'push' | 'ok' | 'err'

export default function App() {
  const [cursor, setCursor] = useState(() => new Date())
  const [selectedKey, setSelectedKey] = useState(todayKey)
  const [schedule, setSchedule] = useState<ScheduleMap>({})
  const [message, setMessage] = useState('正在读取公开日程…')
  const [pane, setPane] = useState<'calendar' | 'day'>('calendar')
  const [fp, setFp] = useState('')
  const [phrase, setPhrase] = useState('')
  const [askPhrase, setAskPhrase] = useState(false)
  const [unlocking, setUnlocking] = useState(false)
  const [unlockError, setUnlockError] = useState('')
  const [phase, setPhase] = useState<SyncPhase>('pull')
  const shaRef = useRef('')
  const pushTimer = useRef(0)
  const dirtyRef = useRef(false)
  const pendingRef = useRef<ScheduleMap | null>(null)
  const today = useMemo(() => new Date(), [])

  useEffect(() => {
    void fingerprint(schedule).then(setFp)
  }, [schedule])

  useEffect(() => {
    if (phase !== 'ok') return
    const t = window.setTimeout(() => setPhase('off'), 1400)
    return () => window.clearTimeout(t)
  }, [phase])

  useEffect(() => {
    let stop = false
    async function hydrate() {
      setPhase('pull')
      try {
        const remote = await pullCloud()
        if (stop || !remote) return
        shaRef.current = remote.sha || shaRef.current
        if (dirtyRef.current) {
          setPhase('off')
          return
        }
        const over = loadOverlay()
        const merged = overlayBusy(over) ? applyOverlay(remote.map, over) : remote.map
        setSchedule(merged)
        const n = Object.values(remote.map).flat().length
        setMessage(n > 0 ? '已载入公开日程' : '公开日程还是空的')
        setPhase('ok')
        if (overlayBusy(over) && getWriteToken()) {
          pendingRef.current = merged
          dirtyRef.current = true
          flush(merged)
        }
      } catch (err) {
        setPhase('err')
        setMessage(err instanceof Error ? err.message : '公开日程读取失败，先用本机缓存')
      }
    }
    void hydrate()
    const tick = window.setInterval(() => {
      if (dirtyRef.current) return
      void pullCloud()
        .then((remote) => {
          if (!remote || dirtyRef.current) return
          shaRef.current = remote.sha || shaRef.current
          setSchedule((cur) => {
            const a = JSON.stringify(cur)
            const b = JSON.stringify(remote.map)
            if (a === b) return cur
            return remote.map
          })
        })
        .catch(() => {})
    }, 8000)
    return () => {
      stop = true
      window.clearInterval(tick)
    }
  }, [])

  function flush(map: ScheduleMap) {
    if (!getWriteToken()) {
      dirtyRef.current = true
      pendingRef.current = map
      setAskPhrase(true)
      setPhase('err')
      setMessage('改动已记下，输入同步口令后电脑也能看见')
      return
    }
    setPhase('push')
    void pushCloud(map, shaRef.current)
      .then((sha) => {
        shaRef.current = sha
        dirtyRef.current = false
        pendingRef.current = null
        saveOverlay(emptyOverlay())
        setAskPhrase(false)
        setPhase('ok')
        setMessage('已同步到电脑和手机')
      })
      .catch(async (err) => {
        const text = err instanceof Error ? err.message : '同步失败'
        if (text.includes('令牌')) {
          setAskPhrase(true)
          setPhase('err')
          setMessage('需要同步口令才能写到公开课表')
          return
        }
        if (text === '冲突') {
          try {
            const remote = await pullCloud()
            if (remote) {
              shaRef.current = remote.sha
              const sha = await pushCloud(map, remote.sha)
              shaRef.current = sha
              dirtyRef.current = false
              pendingRef.current = null
              saveOverlay(emptyOverlay())
              setPhase('ok')
              setMessage('已同步到电脑和手机')
              return
            }
          } catch {
            /* fall through */
          }
        }
        setPhase('err')
        setMessage(text)
      })
  }

  function commit(next: ScheduleMap) {
    dirtyRef.current = true
    pendingRef.current = next
    setSchedule(next)
    window.clearTimeout(pushTimer.current)
    pushTimer.current = window.setTimeout(() => flush(next), 400)
  }

  const selected = parseDateKey(selectedKey)
  const items = [...(schedule[selectedKey] ?? [])].sort((a, b) => {
    const ta = timeSortKey(a)
    const tb = timeSortKey(b)
    if (ta !== tb) return ta.localeCompare(tb)
    const ad = a.allDay || a.kind === 'holiday'
    const bd = b.allDay || b.kind === 'holiday'
    if (ad && !bd) return -1
    if (!ad && bd) return 1
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
          <span className="brand-kicker">Daily checklist</span>
          <h1>H2 Schedule</h1>
          {fp ? <div className="fp">指纹 {fp}</div> : null}
        </div>
        <div className="top-actions">
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
      </nav>
      <div className={`layout pane-${pane}`}>
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
          date={selected}
          items={items}
          onPrevDay={() => {
            const d = addDays(selected, -1)
            setSelectedKey(toDateKey(d))
            setCursor(new Date(d.getFullYear(), d.getMonth(), 1))
            setPane('day')
          }}
          onNextDay={() => {
            const d = addDays(selected, 1)
            setSelectedKey(toDateKey(d))
            setCursor(new Date(d.getFullYear(), d.getMonth(), 1))
            setPane('day')
          }}
          onToggle={(id) => {
            const list = (schedule[selectedKey] ?? []).map((item) =>
              item.id === id ? { ...item, done: !item.done } : item,
            )
            commit({ ...schedule, [selectedKey]: list })
          }}
          onRemove={(id) => {
            const list = (schedule[selectedKey] ?? []).filter((item) => item.id !== id)
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
            const list = (schedule[selectedKey] ?? []).map((item) =>
              item.id === id
                ? {
                    ...item,
                    title: draft.title,
                    kind: draft.kind,
                    allDay: draft.allDay || undefined,
                    start: draft.allDay ? undefined : draft.start || undefined,
                    end: draft.allDay ? undefined : draft.end || undefined,
                  }
                : item,
            )
            commit({ ...schedule, [selectedKey]: list })
          }}
        />
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
                void unlockFromPublic(p)
                  .then((token) => {
                    setWriteToken(token)
                    setPhrase('')
                    setMessage('口令正确，正在同步…')
                    return pushCloud(pendingRef.current ?? schedule, shaRef.current)
                  })
                  .then((sha) => {
                    shaRef.current = sha
                    dirtyRef.current = false
                    pendingRef.current = null
                    saveOverlay(emptyOverlay())
                    setAskPhrase(false)
                    setUnlocking(false)
                    setPhase('ok')
                    setMessage('已同步到电脑和手机')
                  })
                  .catch((err: unknown) => {
                    setUnlocking(false)
                    setUnlockError(err instanceof Error ? err.message : '开通失败')
                    setPhase('err')
                  })
              }, 50)
            }}
          >
            <h2>同步口令</h2>
            <p>
              手机和电脑用同一句口令。点开通后请等一两秒，顶上绿条走完就成功了。
            </p>
            <label htmlFor="sync-phrase">口令</label>
            <input
              id="sync-phrase"
              type="text"
              autoComplete="off"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              placeholder="例如 5BVHPUZ7"
              value={phrase}
              disabled={unlocking}
              onChange={(e) => setPhrase(e.target.value)}
            />
            {unlockError ? <p className="unlock-error">{unlockError}</p> : null}
            <div className="sync-actions">
              <button className="solid" type="submit" disabled={unlocking}>
                {unlocking ? '正在开通…' : '开通并同步'}
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
