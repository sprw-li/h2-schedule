import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarPanel } from './components/CalendarPanel'
import { DayPanel } from './components/DayPanel'
import {
  decryptBackup,
  encryptBackup,
  fingerprint,
  flattenItems,
  isEncryptedBackup,
  replaceSchedule,
} from './lib/backup'
import { addMonths, parseDateKey, toDateKey, todayKey } from './lib/dates'
import { parseImportFile } from './lib/importSchedule'
import { loadSchedule, mergeItems, saveSchedule, uid } from './lib/storage'
import type { ItemKind, ScheduleMap } from './types'

function downloadText(filename: string, text: string, type: string) {
  const blob = new Blob([text], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export default function App() {
  const [cursor, setCursor] = useState(() => new Date())
  const [selectedKey, setSelectedKey] = useState(todayKey)
  const [schedule, setSchedule] = useState<ScheduleMap>(loadSchedule)
  const [message, setMessage] = useState('')
  const [pane, setPane] = useState<'calendar' | 'day'>('calendar')
  const [syncOpen, setSyncOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [fp, setFp] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const syncFileRef = useRef<HTMLInputElement>(null)
  const today = useMemo(() => new Date(), [])

  useEffect(() => {
    void fingerprint(schedule).then(setFp)
  }, [schedule])

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
          <button type="button" className="ghost" onClick={() => fileRef.current?.click()}>
            导入
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => {
              const all = flattenItems(schedule)
              downloadText(
                `h2-schedule-${todayKey()}.json`,
                JSON.stringify({ items: all }, null, 2),
                'application/json',
              )
              setMessage(`已导出明文 ${all.length} 条。同步请用「同步」并设密码。`)
            }}
          >
            导出
          </button>
          <button type="button" className="solid" onClick={() => setSyncOpen(true)}>
            同步
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
                if (isEncryptedBackup(raw)) {
                  setMessage('这是加密备份。请点「同步」导入，并输入密码。')
                  return
                }
                const imported = parseImportFile(file.name, raw)
                if (imported.length === 0) {
                  setMessage('没有解析到可导入的事项。请使用 CSV / ICS / JSON。')
                  return
                }
                commit(mergeItems(schedule, imported))
                setSelectedKey(imported[0].date)
                setCursor(parseDateKey(imported[0].date))
                setPane('day')
                setMessage(`已合并导入 ${imported.length} 条。`)
              } catch (err) {
                setMessage(err instanceof Error ? err.message : '导入失败')
              }
            }}
          />
          <input
            ref={syncFileRef}
            className="hidden-input"
            type="file"
            accept=".json,.h2bak,application/json"
            onChange={async (e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (!file) return
              const pwd = password.trim()
              if (!pwd) {
                setMessage('请先填写同步密码。')
                return
              }
              try {
                const raw = await file.text()
                const incoming = isEncryptedBackup(raw)
                  ? await decryptBackup(raw, pwd)
                  : parseImportFile(file.name, raw)
                if (incoming.length === 0) {
                  setMessage('备份里没有事项。')
                  return
                }
                const next = replaceSchedule(incoming)
                commit(next)
                const mark = await fingerprint(next)
                setSelectedKey(Object.keys(next).sort()[0] ?? todayKey())
                setPane('day')
                setSyncOpen(false)
                setPassword('')
                setMessage(`已覆盖同步 ${incoming.length} 条。指纹 ${mark}，请与另一端核对。`)
              } catch (err) {
                setMessage(err instanceof Error ? err.message : '同步导入失败')
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
      {syncOpen ? (
        <div className="sync-scrim" onClick={() => setSyncOpen(false)}>
          <div
            className="sync-card"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-labelledby="sync-title"
          >
            <h2 id="sync-title">双端同步</h2>
            <p>
              密码只用来加密备份文件，不会上传 Git。两端用同一密码；导入后覆盖本机清单，指纹一致即同步成功。
            </p>
            <label htmlFor="sync-pass">同步密码</label>
            <input
              id="sync-pass"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <div className="sync-actions">
              <button
                type="button"
                className="solid"
                onClick={async () => {
                  const pwd = password.trim()
                  if (pwd.length < 4) {
                    setMessage('密码至少 4 位。')
                    return
                  }
                  try {
                    const text = await encryptBackup(schedule, pwd)
                    downloadText(`h2-schedule-${todayKey()}.h2bak.json`, text, 'application/json')
                    setMessage(`已导出加密备份。指纹 ${fp}。把文件拷到另一端再导入。`)
                  } catch (err) {
                    setMessage(err instanceof Error ? err.message : '加密导出失败')
                  }
                }}
              >
                导出加密备份
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  if (password.trim().length < 4) {
                    setMessage('请先填写同一同步密码。')
                    return
                  }
                  syncFileRef.current?.click()
                }}
              >
                导入加密备份
              </button>
              <button type="button" className="ghost" onClick={() => setSyncOpen(false)}>
                关闭
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
