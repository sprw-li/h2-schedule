import { useState } from 'react'
import type { FormEvent } from 'react'
import type { ItemKind, ScheduleItem } from '../types'
import { formatDayHeading, weekdayLabel } from '../lib/dates'

type Props = {
  date: Date
  items: ScheduleItem[]
  onToggle: (id: string) => void
  onRemove: (id: string) => void
  onAdd: (title: string, time: string, kind: ItemKind) => void
}

export function DayPanel({ date, items, onToggle, onRemove, onAdd }: Props) {
  const [title, setTitle] = useState('')
  const [time, setTime] = useState('')
  const [kind, setKind] = useState<ItemKind>('task')

  const pending = items.filter((i) => !i.done).length

  function submit(e: FormEvent) {
    e.preventDefault()
    const t = title.trim()
    if (!t) return
    onAdd(t, time, kind)
    setTitle('')
    setTime('')
    setKind('task')
  }

  return (
    <section className="panel day-panel">
      <h2>{formatDayHeading(date)}</h2>
      <div className="day-meta">
        {weekdayLabel(date)} · 清单 {pending}/{items.length}
      </div>
      <div className="section-label">当日清单</div>
      {items.length === 0 ? (
        <div className="empty">这一天还没有事项。在下方写入第一条。</div>
      ) : (
        <div className="list">
          {items.map((item) => (
            <div
              key={item.id}
              className={`item${item.done ? ' done' : ''}${item.kind === 'deadline' ? ' deadline' : ''}`}
            >
              <button
                type="button"
                className="check"
                aria-label={item.done ? '标为未完成' : '标为完成'}
                onClick={() => onToggle(item.id)}
              />
              <span className="title">{item.title}</span>
              <span className={`time${item.kind === 'deadline' ? ' deadline' : ''}`}>
                {item.time || (item.kind === 'deadline' ? '截止' : '')}
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
          ))}
        </div>
      )}
      <form className="composer" onSubmit={submit}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="添加事项"
          aria-label="事项标题"
        />
        <input
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          aria-label="时间"
        />
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as ItemKind)}
          aria-label="类型"
        >
          <option value="task">普通</option>
          <option value="deadline">截止日期</option>
        </select>
        <button className="solid" type="submit">
          加入
        </button>
      </form>
    </section>
  )
}
