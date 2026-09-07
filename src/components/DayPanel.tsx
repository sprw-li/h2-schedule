import { useState } from 'react'
import type { FormEvent } from 'react'
import type { ItemKind, ScheduleItem } from '../types'
import { formatDayHeading, formatWhen, resolveTimes, weekdayLabel } from '../lib/dates'

type Props = {
  date: Date
  items: ScheduleItem[]
  onToggle: (id: string) => void
  onRemove: (id: string) => void
  onAdd: (title: string, start: string, end: string, kind: ItemKind) => void
  onPrevDay: () => void
  onNextDay: () => void
}

export function DayPanel({
  date,
  items,
  onToggle,
  onRemove,
  onAdd,
  onPrevDay,
  onNextDay,
}: Props) {
  const [title, setTitle] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [deadline, setDeadline] = useState(false)

  const pending = items.filter((i) => !i.done).length

  function submit(e: FormEvent) {
    e.preventDefault()
    const t = title.trim()
    if (!t) return
    const kind: ItemKind = deadline || (!start && !!end) ? 'deadline' : 'task'
    onAdd(t, start, end, kind)
    setTitle('')
    setStart('')
    setEnd('')
    setDeadline(false)
  }

  return (
    <section className="panel day-panel">
      <div className="cal-head">
        <h2>{formatDayHeading(date)}</h2>
        <div className="nav">
          <button type="button" onClick={onPrevDay} aria-label="上一天">
            ‹
          </button>
          <button type="button" onClick={onNextDay} aria-label="下一天">
            ›
          </button>
        </div>
      </div>
      <div className="day-meta">
        {weekdayLabel(date)} · 清单 {pending}/{items.length}
      </div>
      <div className="section-label">当日清单</div>
      {items.length === 0 ? (
        <div className="empty">这一天还没有事项。在下方写入第一条。</div>
      ) : (
        <div className="list">
          {items.map((item) => {
            const { start: s, end: e } = resolveTimes(item)
            const label = formatWhen(s, e)
            const due = item.kind === 'deadline' || (!s && !!e)
            return (
              <div
                key={item.id}
                className={`item${item.done ? ' done' : ''}${due ? ' deadline' : ''}`}
              >
                <button
                  type="button"
                  className="check"
                  aria-label={item.done ? '标为未完成' : '标为完成'}
                  onClick={() => onToggle(item.id)}
                />
                <span className="title">{item.title}</span>
                <span className={`time${due ? ' deadline' : ''}`}>
                  {label || (due ? '截止' : '')}
                </span>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="删除"
                  onClick={() => onRemove(item.id)}
                >
                  ×
                </button>
              </div>
            )
          })}
        </div>
      )}
      <form className="composer" onSubmit={submit}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="添加事项"
          aria-label="事项标题"
        />
        <label className="time-field">
          起
          <input type="time" value={start} onChange={(e) => setStart(e.target.value)} aria-label="开始时间" />
        </label>
        <label className="time-field">
          止
          <input
            type="time"
            value={end}
            onChange={(e) => {
              setEnd(e.target.value)
              if (e.target.value && !start) setDeadline(true)
            }}
            aria-label="结束时间"
          />
        </label>
        <button
          type="button"
          className={deadline ? 'solid' : 'ghost'}
          aria-pressed={deadline}
          onClick={() => setDeadline((v) => !v)}
        >
          截止
        </button>
        <button className="solid" type="submit">
          加入
        </button>
      </form>
    </section>
  )
}
