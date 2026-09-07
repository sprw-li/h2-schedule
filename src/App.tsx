import { useMemo, useRef, useState } from 'react'
import { CalendarPanel } from './components/CalendarPanel'
import { DayPanel } from './components/DayPanel'
import { addMonths, parseDateKey, toDateKey, todayKey } from './lib/dates'
import { parseImportFile } from './lib/importSchedule'
import { loadSchedule, mergeItems, saveSchedule, uid } from './lib/storage'
import type { ItemKind, ScheduleMap } from './types'

export default function App() {
  const [cursor, setCursor] = useState(() => new Date())
  const [selectedKey, setSelectedKey] = useState(todayKey)
  const [schedule, setSchedule] = useState<ScheduleMap>(loadSchedule)
  const [message, setMessage] = useState('')
  const [pane, setPane] = useState<'calendar' | 'day'>('calendar')
  const fileRef = useRef<HTMLInputElement>(null)
  const today = useMemo(() => new Date(), [])

  function commit(next: ScheduleMap) {
    setSchedule(next)
    saveSchedule(next)
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
          <button type="button" className="ghost" onClick={() => fileRef.current?.click()}>
            导入
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => {
              const items = Object.values(schedule).flat()
              const blob = new Blob([JSON.stringify({ items }, null, 2)], {
                type: 'application/json',
              })
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url
              a.download = `h2-schedule-${todayKey()}.json`
              a.click()
              URL.revokeObjectURL(url)
              setMessage(`已导出 ${items.length} 条，可拷到另一台设备再导入。`)
            }}
          >
            导出
          </button>
          <input
            ref={fileRef}
            className="hidden-input"
            type="file"
            accept=".csv,.ics,.json,text/csv,text/calendar,application/json"
            onChange={async (e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (!file) return
              try {
                const raw = await file.text()
                const imported = parseImportFile(file.name, raw)
                if (imported.length === 0) {
                  setMessage('没有解析到可导入的事项。请使用 CSV / ICS / JSON。')
                  return
                }
                commit(mergeItems(schedule, imported))
                setSelectedKey(imported[0].date)
                setCursor(parseDateKey(imported[0].date))
                setPane('day')
                setMessage(`已导入 ${imported.length} 条。`)
              } catch (err) {
                setMessage(err instanceof Error ? err.message : '导入失败')
              }
            }}
          />
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
    </div>
  )
}
