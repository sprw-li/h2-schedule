import { useMemo } from 'react'
import type { ItemKind, ScheduleItem, ScheduleMap } from '../types'
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

/**
 * 月历色点：该 kind 只要存在一条 done≠true 就亮；
 * 全部 done=true（或没有该 kind）才不亮。
 * 灰=事项、红=截止、绿=假日。
 */
function dayDotFlags(items: ScheduleItem[]) {
  const of = (kind: ItemKind) => items.filter((i) => i.kind === kind)
  const anyOpen = (list: ScheduleItem[]) => list.some((i) => i.done !== true)
  return {
    task: anyOpen(of('task')),
    holiday: anyOpen(of('holiday')),
    deadline: anyOpen(of('deadline')),
  }
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
      <div className="sheet-scroll">
        <div className="weekdays">
          {WEEKDAYS.map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>
        <div className="grid">
          {cells.map((d) => {
            const key = toDateKey(d)
            const { task, holiday, deadline } = dayDotFlags(schedule[key] ?? [])
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
                  {task ? <span className="dot task" /> : null}
                  {holiday ? <span className="dot holiday" /> : null}
                  {deadline ? <span className="dot deadline" /> : null}
                </span>
              </button>
            )
          })}
        </div>
        <div className="legend">
          <span>
            <i className="taski" /> 事项
          </span>
          <span>
            <i className="holi" /> 假日
          </span>
          <span>
            <i className="dead" /> 截止
          </span>
          <span className="legend-note">有未完成才亮</span>
        </div>
      </div>
    </section>
  )
}
