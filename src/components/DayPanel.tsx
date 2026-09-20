import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CSSProperties, FormEvent, ReactNode } from 'react'
import type { ItemKind, ScheduleItem } from '../types'
import {
  formatDayHeading,
  formatWhen,
  hmToDayPercent,
  isAllDay,
  nowDayPercent,
  resolveTimes,
  sameDay,
  toDateKey,
  weekdayLabel,
} from '../lib/dates'
import { slotKey } from '../lib/schedule'

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
  onToggle: (item: ScheduleItem) => void
  onRemove: (item: ScheduleItem) => void
  onAdd: (draft: Draft) => void
  onUpdate: (item: ScheduleItem, draft: Draft) => void
  onPrevDay: () => void
  onNextDay: () => void
  /** 编辑/新事项打开时通知父级，暂停轮询以免冲掉编辑框 */
  onEditorOpenChange?: (open: boolean) => void
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
  const dateKey = toDateKey(date)

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
        {bands.map((band, index) => (
          <span
            key={`${dateKey}:${band.id}:${band.title}:${index}`}
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

function EditorPortal({
  label,
  children,
  onClose,
}: {
  label: string
  children: ReactNode
  onClose: () => void
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCloseRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    const t = window.setTimeout(() => {
      rootRef.current?.querySelector<HTMLInputElement>('input[aria-label="事项标题"]')?.focus()
    }, 40)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  return createPortal(
    <div ref={rootRef} className="sheet-editor-portal" role="dialog" aria-modal="true" aria-label={label}>
      {children}
    </div>,
    document.body,
  )
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
  onEditorOpenChange,
}: Props) {
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<Draft>(emptyDraft)
  const [composerOpen, setComposerOpen] = useState(false)
  const dateKey = toDateKey(date)
  const onEditorOpenChangeRef = useRef(onEditorOpenChange)
  onEditorOpenChangeRef.current = onEditorOpenChange
  const listRef = useRef<HTMLDivElement>(null)
  const editorOpen = !!(editingKey || composerOpen)
  const frozenItemsRef = useRef(items)
  if (!editorOpen) frozenItemsRef.current = items
  const viewItems = editorOpen ? frozenItemsRef.current : items
  const pending = viewItems.filter((i) => !i.done).length
  const listSig = `${dateKey}:${viewItems.length}:${viewItems[0]?.title ?? ''}:${viewItems[0]?.start ?? ''}`
  const dayNudge = `${(Number(dateKey.replace(/-/g, '')) % 19) * 0.04}px`

  // 只能依赖日期字符串：父组件每次渲染都会 new Date()，用 Date 对象当 deps 会误关编辑框
  useLayoutEffect(() => {
    setEditingKey(null)
    setEditDraft(emptyDraft())
    setComposerOpen(false)
    setDraft(emptyDraft())
  }, [dateKey])

  const editorOpenRef = useRef(editorOpen)
  editorOpenRef.current = editorOpen

  useLayoutEffect(() => {
    if (editorOpenRef.current) return
    const el = listRef.current
    if (!el) return
    el.scrollTop = 0
    void el.offsetHeight
  }, [dateKey, listSig])

  useLayoutEffect(() => {
    onEditorOpenChangeRef.current?.(editorOpen)
  }, [editorOpen])

  function closeEditor() {
    setEditingKey(null)
    setComposerOpen(false)
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    const t = draft.title.trim()
    if (!t) return
    onAdd({ ...draft, title: t })
    setDraft(emptyDraft())
    setComposerOpen(false)
  }

  const editor = composerOpen && !editingKey ? (
    <EditorPortal label="新事项" onClose={closeEditor}>
      <form className="composer sheet-editor-form" onSubmit={submit}>
        <div className="sheet-editor-head">
          <strong>新事项</strong>
          <button type="button" className="ghost" onClick={closeEditor}>
            收起
          </button>
        </div>
        <Fields draft={draft} onChange={setDraft} />
        <button className="solid composer-add" type="submit">
          加入
        </button>
      </form>
    </EditorPortal>
  ) : editingKey ? (
    <EditorPortal label="修改事项" onClose={closeEditor}>
      <form
        className="item-edit sheet-editor-form"
        onSubmit={(ev) => {
          ev.preventDefault()
          const t = editDraft.title.trim()
          if (!t) return
          const current = viewItems.find((i) => slotKey(i) === editingKey)
          if (!current) return
          onUpdate(current, { ...editDraft, title: t })
          setEditingKey(null)
        }}
      >
        <div className="sheet-editor-head">
          <strong>修改事项</strong>
          <button type="button" className="ghost" onClick={closeEditor}>
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
    </EditorPortal>
  ) : null

  return (
    <section
      className={`panel day-panel${editorOpen ? ' day-focus' : ''}`}
      data-day={dateKey}
      style={{ '--day-nudge': dayNudge } as CSSProperties}
    >
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
          {weekdayLabel(date)} · 清单 {pending}/{viewItems.length}
        </div>
        <DayScale key={dateKey} date={date} items={viewItems} />
      </div>
      {viewItems.length === 0 ? (
        <div key={editorOpen ? `empty-lock-${dateKey}` : `empty-${listSig}`} ref={listRef} className="sheet-scroll empty" data-day={dateKey}>
          这一天还没有事项。点下方「新事项」写入。
        </div>
      ) : (
        <div
          key={editorOpen ? `list-lock-${dateKey}` : `list-${listSig}`}
          ref={listRef}
          id={`day-list-${dateKey}`}
          className="sheet-scroll list"
          data-day={dateKey}
        >
          {viewItems.map((item) => {
            const holiday = item.kind === 'holiday'
            const due = item.kind === 'deadline'
            const allDay = isAllDay(item)
            const { start: s, end: e } = resolveTimes(item)
            const label = allDay ? '全天' : formatWhen(s, e)
            return (
              <div
                key={`${dateKey}:${item.id}:${item.title}`}
                data-day={dateKey}
                data-title={item.title}
                className={`item${item.done ? ' done' : ''}${due ? ' deadline' : ''}${holiday ? ' holiday' : ''}${editingKey === slotKey(item) ? ' editing' : ''}`}
              >
                <button
                  type="button"
                  className="item-main"
                  aria-label={item.done ? '标为未完成' : '标为完成'}
                  onClick={() => onToggle(item)}
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
                      onEditorOpenChange?.(true)
                      setComposerOpen(false)
                      setEditingKey(slotKey(item))
                      setEditDraft(toDraft(item))
                    }}
                  >
                    改
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="删除"
                    onClick={() => onRemove(item)}
                  >
                    ×
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {!editingKey && !composerOpen ? (
        <div className="composer-bar">
          <button
            type="button"
            className="solid composer-open"
            onClick={() => {
              onEditorOpenChange?.(true)
              setComposerOpen(true)
            }}
          >
            新事项
          </button>
        </div>
      ) : null}

      {editor}
    </section>
  )
}

