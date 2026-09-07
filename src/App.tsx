import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarPanel } from './components/CalendarPanel'
import { DayPanel } from './components/DayPanel'
import { fingerprint } from './lib/backup'
import { getWriteToken, pullCloud, pushCloud, setWriteToken } from './lib/cloud'
import { addMonths, parseDateKey, toDateKey, todayKey } from './lib/dates'
import { loadSchedule, saveSchedule, uid } from './lib/storage'
import type { ItemKind, ScheduleMap } from './types'

export default function App() {
  const [cursor, setCursor] = useState(() => new Date())
  const [selectedKey, setSelectedKey] = useState(todayKey)
  const [schedule, setSchedule] = useState<ScheduleMap>(loadSchedule)
  const [message, setMessage] = useState('正在读取公开日程…')
  const [pane, setPane] = useState<'calendar' | 'day'>('calendar')
  const [fp, setFp] = useState('')
  const [token, setToken] = useState(getWriteToken)
  const [needToken, setNeedToken] = useState(!getWriteToken())
  const shaRef = useRef('')
  const pushTimer = useRef(0)
  const dirtyRef = useRef(false)
  const today = useMemo(() => new Date(), [])

  useEffect(() => {
    void fingerprint(schedule).then(setFp)
  }, [schedule])

  useEffect(() => {
    let stop = false
    async function hydrate() {
      try {
        const remote = await pullCloud()
        if (stop || !remote) return
        shaRef.current = remote.sha
        const remoteCount = Object.values(remote.map).flat().length
        if (remoteCount > 0) {
          setSchedule(remote.map)
          saveSchedule(remote.map)
          setMessage('已载入公开日程')
        } else {
          setMessage('公开日程还是空的，记下后会自动同步')
        }
      } catch (err) {
        setMessage(err instanceof Error ? err.message : '公开日程读取失败，先用本机缓存')
      }
    }
    void hydrate()
    const tick = window.setInterval(() => {
      if (dirtyRef.current) return
      void pullCloud()
        .then((remote) => {
          if (!remote) return
          shaRef.current = remote.sha || shaRef.current
          setSchedule((cur) => {
            const a = JSON.stringify(cur)
            const b = JSON.stringify(remote.map)
            if (a === b) return cur
            saveSchedule(remote.map)
            return remote.map
          })
        })
        .catch(() => {})
    }, 12000)
    return () => {
      stop = true
      window.clearInterval(tick)
    }
    // only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function commit(next: ScheduleMap) {
    dirtyRef.current = true
    setSchedule(next)
    saveSchedule(next)
    window.clearTimeout(pushTimer.current)
    pushTimer.current = window.setTimeout(() => {
      void pushCloud(next, shaRef.current)
        .then((sha) => {
          shaRef.current = sha
          dirtyRef.current = false
          setNeedToken(false)
          setMessage('已同步到公开仓库')
        })
        .catch(async (err) => {
          const text = err instanceof Error ? err.message : '同步失败'
          if (text.includes('令牌')) setNeedToken(true)
          if (text === '冲突') {
            try {
              const remote = await pullCloud()
              if (remote) {
                shaRef.current = remote.sha
                await pushCloud(next, remote.sha).then((sha) => {
                  shaRef.current = sha
                  setMessage('已同步到公开仓库')
                })
                return
              }
            } catch {
              /* fall through */
            }
          }
          setMessage(text)
        })
    }, 800)
  }

  const selected = parseDateKey(selectedKey)
  const items = [...(schedule[selectedKey] ?? [])].sort((a, b) => {
    const ta = a.time ?? '99:99'
    const tb = b.time ?? '99:99'
    if (ta !== tb) return ta.localeCompare(tb)
    if (a.kind !== b.kind) return a.kind === 'deadline' ? -1 : 1
    return a.title.localeCompare(b.title, 'zh')
  })

  return (
    <div className="app">
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
          onAdd={(title, time, kind: ItemKind) => {
            const item = {
              id: uid(),
              date: selectedKey,
              title,
              done: false,
              kind,
              time: time || undefined,
            }
            commit({
              ...schedule,
              [selectedKey]: [...(schedule[selectedKey] ?? []), item],
            })
          }}
        />
      </div>
      {message ? <div className="toast">{message}</div> : null}
      {needToken ? (
        <form
          className="token-bar"
          onSubmit={(e) => {
            e.preventDefault()
            setWriteToken(token)
            setNeedToken(!token.trim())
            setMessage(token.trim() ? '写入令牌已保存在本机，改日程会自动同步。' : '已清除令牌')
            commit(schedule)
          }}
        >
          <span>公开仓库写入（只存在这台设备，不进 Git）</span>
          <input
            type="password"
            autoComplete="off"
            placeholder="GitHub Token，Contents 权限"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          <button className="solid" type="submit">
            保存
          </button>
        </form>
      ) : null}
    </div>
  )
}
