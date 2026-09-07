import { useMemo } from 'react'
import type { ScheduleMap } from '../types'
import {
  formatMonthTitle,
  monthGrid,
  sameDay,
  toDateKey,
} from '../lib/dates'

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

type Props = {
  view: Date
  selected: Date
  today: Date
  schedule: ScheduleMap
  onSelect: (d: Date) => void
  onPrev: () => void
  onNext: () => void
}

export function CalendarPanel({
  view,
  selected,
  today,
  schedule,
  onSelect,
  onPrev,
  onNext,
}: Props) {
  const cells = useMemo(() => monthGrid(view), [view])

  return (
    <section className="panel calendar-panel">
      <div className="cal-head">
        <h2>{formatMonthTitle(view)}</h2>
        <div className="nav">
          <button type="button" onClick={onPrev} aria-label="上一月">
            ‹
          </button>
          <button type="button" onClick={onNext} aria-label="下一月">
            ›
          </button>
        </div>
      </div>
      <div className="weekdays">
        {WEEKDAYS.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="grid">
        {cells.map((d) => {
          const key = toDateKey(d)
          const items = schedule[key] ?? []
          const hasTask = items.some((i) => i.kind === 'task')
          const hasDeadline = items.some((i) => i.kind === 'deadline')
          const out = d.getMonth() !== view.getMonth()
          const cls = [
            'day',
            out ? 'out' : '',
            sameDay(d, selected) ? 'selected' : '',
            sameDay(d, today) ? 'today' : '',
          ]
            .filter(Boolean)
            .join(' ')
          return (
            <button
              key={key}
              type="button"
              className={cls}
              aria-label={key}
              aria-pressed={sameDay(d, selected)}
              onClick={() => onSelect(d)}
            >
              <span className="day-num">{d.getDate()}</span>
              <span className="dots">
                {hasTask ? <span className="dot" /> : null}
                {hasDeadline ? <span className="dot deadline" /> : null}
              </span>
            </button>
          )
        })}
      </div>
      <div className="legend">
        <span>
          <i /> 普通事项
        </span>
        <span>
          <i className="dead" /> 截止日期
        </span>
      </div>
    </section>
  )
}
