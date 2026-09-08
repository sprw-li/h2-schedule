import { useEffect, useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'
import type { ItemKind, ScheduleItem } from '../types'
import {
  formatDayHeading,
  formatWhen,
  hmToDayPercent,
  isAllDay,
  nowDayPercent,
  resolveTimes,
  sameDay,
  weekdayLabel,
} from '../lib/dates'

type Draft = {
  title: string
  start: string
  end: string
  allDay: boolean
  kind: ItemKind
}

const emptyDraft = (): Draft => ({
  title: '',
  start: '',
  end: '',
  allDay: false,
  kind: 'task',
})

const KIND_CHIPS: { kind: ItemKind; label: string }[] = [
  { kind: 'holiday', label: '绿' },
  { kind: 'task', label: '灰' },
  { kind: 'deadline', label: '红' },
]

type Props = {
  date: Date
  items: ScheduleItem[]
  onToggle: (id: string) => void
  onRemove: (id: string) => void
  onAdd: (draft: Draft) => void
  onUpdate: (id: string, draft: Draft) => void
  onPrevDay: () => void
  onNextDay: () => void
}

function Fields({
  draft,
  onChange,
}: {
  draft: Draft
  onChange: (next: Draft) => void
}) {
  return (
    <>
      <input
        value={draft.title}
        onChange={(e) => onChange({ ...draft, title: e.target.value })}
        placeholder="事项标题"
        aria-label="事项标题"
      />
      <div className="composer-times">
        <label className="time-field">
          起
          <input
            type="time"
            value={draft.start}
            disabled={draft.allDay}
            onChange={(e) => onChange({ ...draft, start: e.target.value, allDay: false })}
            aria-label="开始时间"
          />
        </label>
        <label className="time-field">
          止
          <input
            type="time"
            value={draft.end}
            disabled={draft.allDay}
            onChange={(e) => {
              const end = e.target.value
              onChange({
                ...draft,
                end,
                allDay: false,
                kind: end && !draft.start && draft.kind === 'task' ? 'deadline' : draft.kind,
              })
            }}
            aria-label="结束时间"
          />
        </label>
        <button
          type="button"
          className={draft.allDay ? 'solid allday-btn' : 'ghost allday-btn'}
          aria-pressed={draft.allDay}
          onClick={() =>
            onChange({
              ...draft,
              allDay: !draft.allDay,
              start: draft.allDay ? draft.start : '',
              end: draft.allDay ? draft.end : '',
            })
          }
        >
          全天
        </button>
      </div>
      <div className="composer-flags">
        <div className="kind-scale" role="radiogroup" aria-label="颜色">
          {KIND_CHIPS.map(({ kind, label }) => (
            <button
              key={kind}
              type="button"
              role="radio"
              className={`chip ${kind}${draft.kind === kind ? ' on' : ''}`}
              aria-checked={draft.kind === kind}
              aria-pressed={draft.kind === kind}
              aria-label={`${label}点`}
              onClick={() => onChange({ ...draft, kind })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </>
  )
}

const SCALE_TICKS = [
  { label: '0', at: 0 },
  { label: '6', at: 25 },
  { label: '12', at: 50 },
  { label: '18', at: 75 },
  { label: '24', at: 100 },
] as const

const KIND_FILL: Record<ItemKind, string> = {
  task: '#8c8c86',
  deadline: '#c1121f',
  holiday: '#2f7d4a',
}

type ScaleBand = {
  id: string
  kind: ItemKind
  done: boolean
  from: number
  to: number
  mode: 'span' | 'from' | 'until'
  title: string
}

function scaleBands(items: ScheduleItem[]): ScaleBand[] {
  const bands: ScaleBand[] = []
  for (const item of items) {
    if (isAllDay(item)) continue
    const { start, end } = resolveTimes(item)
    const a = start ? hmToDayPercent(start) : undefined
    const b = end ? hmToDayPercent(end) : undefined
    if (a == null && b == null) continue
    if (a != null && b != null) {
      if (a <= b) {
        bands.push({
          id: item.id,
          kind: item.kind,
          done: item.done,
          from: a,
          to: Math.max(b, a + 0.4),
          mode: 'span',
          title: item.title,
        })
      } else {
        bands.push({
          id: `${item.id}-a`,
          kind: item.kind,
          done: item.done,
          from: a,
          to: 100,
          mode: 'from',
          title: item.title,
        })
        bands.push({
          id: `${item.id}-b`,
          kind: item.kind,
          done: item.done,
          from: 0,
          to: Math.max(b, 0.4),
          mode: 'until',
          title: item.title,
        })
      }
      continue
    }
    if (a != null) {
      bands.push({
        id: item.id,
        kind: item.kind,
        done: item.done,
        from: a,
        to: 100,
        mode: 'from',
        title: item.title,
      })
      continue
    }
    bands.push({
      id: item.id,
      kind: item.kind,
      done: item.done,
      from: 0,
      to: Math.max(b ?? 0, 0.4),
      mode: 'until',
      title: item.title,
    })
  }
  return bands
}

function bandStyle(band: ScaleBand): CSSProperties {
  const color = KIND_FILL[band.kind]
  const fade = band.done ? '55' : 'cc'
  const solid = `${color}${fade}`
  let background = solid
  if (band.mode === 'from') {
    background = `linear-gradient(90deg, ${solid} 0%, ${solid} 10%, ${color}00 36%)`
  } else if (band.mode === 'until') {
    background = `linear-gradient(90deg, ${color}00 64%, ${solid} 90%, ${solid} 100%)`
  }
  const from = Math.min(100, Math.max(0, band.from))
  const to = Math.min(100, Math.max(from, band.to))
  return {
    left: `${from}%`,
    width: `${Math.max(to - from, 0.4)}%`,
    background,
  }
}

function DayScale({ date, items }: { date: Date; items: ScheduleItem[] }) {
  const [now, setNow] = useState(() => new Date())
  const today = sameDay(date, now)

  useEffect(() => {
    if (!today) return
    const id = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(id)
  }, [today])

  const bands = scaleBands(items)
  const elapsed = today ? nowDayPercent(now) : null
  const hour = String(now.getHours()).padStart(2, '0')
  const minute = String(now.getMinutes()).padStart(2, '0')

  return (
    <div
      className="day-scale"
      role="img"
      aria-label={
        today
          ? `当日时间轴，现在 ${hour}:${minute}，已过 ${Math.round(elapsed ?? 0)}%`
          : '当日时间轴，0 点到 24 点'
      }
    >
      <div className="day-scale-track">
        {elapsed != null ? (
          <span className="day-scale-elapsed" style={{ width: `${elapsed}%` }} />
        ) : null}
        {bands.map((band) => (
          <span
            key={band.id}
            className={`day-scale-band ${band.kind}${band.done ? ' done' : ''}`}
            style={bandStyle(band)}
            title={band.title}
          />
        ))}
        {SCALE_TICKS.map((tick) => (
          <span key={tick.label} className="day-scale-tick" style={{ left: `${tick.at}%` }} />
        ))}
        {elapsed != null ? (
          <span className="day-scale-now" style={{ left: `${elapsed}%` }} />
        ) : null}
      </div>
      <div className="day-scale-labels" aria-hidden>
        {SCALE_TICKS.map((tick) => (
          <span key={tick.label} style={{ left: `${tick.at}%` }}>
            {tick.label}
          </span>
        ))}
      </div>
    </div>
  )
}

function toDraft(item: ScheduleItem): Draft {
  const { start, end } = resolveTimes(item)
  return {
    title: item.title,
    start: start ?? '',
    end: end ?? '',
    allDay: isAllDay(item),
    kind: item.kind,
  }
}

export function DayPanel({
  date,
  items,
  onToggle,
  onRemove,
  onAdd,
  onUpdate,
  onPrevDay,
  onNextDay,
}: Props) {
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<Draft>(emptyDraft)
  const [composerOpen, setComposerOpen] = useState(false)

  useEffect(() => {
    setEditingId(null)
    setComposerOpen(false)
  }, [date])

  const pending = items.filter((i) => !i.done).length
  const editingItem = editingId ? items.find((i) => i.id === editingId) : undefined

  function submit(e: FormEvent) {
    e.preventDefault()
    const t = draft.title.trim()
    if (!t) return
    onAdd({ ...draft, title: t })
    setDraft(emptyDraft())
    setComposerOpen(false)
  }

  return (
    <section className={`panel day-panel${editingId || composerOpen ? ' day-focus' : ''}`}>
      <div className="day-chrome">
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
        {!editingId && !composerOpen ? <DayScale date={date} items={items} /> : null}
      </div>
      {items.length === 0 ? (
        <div className="sheet-scroll empty">这一天还没有事项。点下方「新事项」写入。</div>
      ) : (
        <div className="sheet-scroll list">
          {items.map((item) => {
            const holiday = item.kind === 'holiday'
            const due = item.kind === 'deadline'
            const allDay = isAllDay(item)
            const { start: s, end: e } = resolveTimes(item)
            const label = allDay ? '全天' : formatWhen(s, e)
            return (
              <div
                key={item.id}
                className={`item${item.done ? ' done' : ''}${due ? ' deadline' : ''}${holiday ? ' holiday' : ''}${editingId === item.id ? ' editing' : ''}`}
              >
                <button
                  type="button"
                  className="item-main"
                  aria-label={item.done ? '标为未完成' : '标为完成'}
                  onClick={() => onToggle(item.id)}
                >
                  <span className="check" aria-hidden />
                  <span className="item-text">
                    <span className="title">{item.title}</span>
                    <span className={`time${due ? ' deadline' : ''}${holiday ? ' holiday' : ''}`}>
                      {label || (due ? '截止' : '')}
                    </span>
                  </span>
                </button>
                <div className="item-actions">
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="修改"
                    onClick={() => {
                      setComposerOpen(false)
                      setEditingId(item.id)
                      setEditDraft(toDraft(item))
                    }}
                  >
                    改
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="删除"
                    onClick={() => onRemove(item.id)}
                  >
                    ×
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {!editingId && !composerOpen ? (
        <div className="composer-bar">
          <button type="button" className="solid composer-open" onClick={() => setComposerOpen(true)}>
            新事项
          </button>
        </div>
      ) : null}

      {composerOpen && !editingId ? (
        <div className="sheet-editor" role="dialog" aria-label="新事项">
          <form className="composer sheet-editor-form" onSubmit={submit}>
            <div className="sheet-editor-head">
              <strong>新事项</strong>
              <button type="button" className="ghost" onClick={() => setComposerOpen(false)}>
                收起
              </button>
            </div>
            <Fields draft={draft} onChange={setDraft} />
            <button className="solid composer-add" type="submit">
              加入
            </button>
          </form>
        </div>
      ) : null}

      {editingId && editingItem ? (
        <div className="sheet-editor" role="dialog" aria-label="修改事项">
          <form
            className="item-edit sheet-editor-form"
            onSubmit={(ev) => {
              ev.preventDefault()
              const t = editDraft.title.trim()
              if (!t) return
              onUpdate(editingId, { ...editDraft, title: t })
              setEditingId(null)
            }}
          >
            <div className="sheet-editor-head">
              <strong>修改事项</strong>
              <button type="button" className="ghost" onClick={() => setEditingId(null)}>
                取消
              </button>
            </div>
            <Fields draft={editDraft} onChange={setEditDraft} />
            <div className="item-edit-actions">
              <button className="solid" type="submit">
                保存
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  )
}

