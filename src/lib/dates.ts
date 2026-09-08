export function pad(n: number) {
  return String(n).padStart(2, '0')
}

export function toDateKey(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function parseDateKey(key: string) {
  const [y, m, day] = key.split('-').map(Number)
  return new Date(y, m - 1, day)
}

export function todayKey() {
  return toDateKey(new Date())
}

export function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

export function addDays(d: Date, delta: number) {
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + delta)
  return next
}

export function addMonths(d: Date, delta: number) {
  return new Date(d.getFullYear(), d.getMonth() + delta, 1)
}

export function isAllDay(item: {
  allDay?: boolean
  start?: string
  end?: string
  time?: string
  kind: string
}) {
  if (item.allDay) return true
  const { start, end } = resolveTimes(item)
  return item.kind === 'holiday' && !start && !end
}

export function resolveTimes(item: {
  start?: string
  end?: string
  time?: string
  kind: string
  allDay?: boolean
}) {
  if (item.allDay) return { start: undefined, end: undefined }
  const start = (item.start || (item.kind === 'deadline' ? '' : item.time || '')).trim()
  const end = (item.end || (item.kind === 'deadline' ? item.time || '' : '')).trim()
  return {
    start: start || undefined,
    end: end || undefined,
  }
}

export function formatWhen(start?: string, end?: string) {
  if (start && end) return `${start}-${end}`
  if (start) return `${start} 起`
  if (end) return `截止 ${end}`
  return ''
}

/** HH:mm → 当日占比 0–100；24:00 记为 100 */
export function hmToDayPercent(hm: string): number | undefined {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm.trim())
  if (!m) return undefined
  const h = Number(m[1])
  const min = Number(m[2])
  if (min > 59) return undefined
  if (h === 24 && min === 0) return 100
  if (h > 23) return undefined
  return ((h * 60 + min) / (24 * 60)) * 100
}

export function nowDayPercent(now = new Date()) {
  const sec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()
  return (sec / 86400) * 100
}

export function timeSortKey(item: {
  start?: string
  end?: string
  time?: string
  kind: string
  allDay?: boolean
}) {
  if (isAllDay(item)) return '00:00'
  const { start, end } = resolveTimes(item)
  return start ?? end ?? '99:99'
}

export function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

export function formatMonthTitle(d: Date) {
  return `${d.getFullYear()} · ${d.getMonth() + 1}`
}

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

export function weekdayLabel(d: Date) {
  const i = (d.getDay() + 6) % 7
  return `星期${WEEKDAYS[i]}`
}

export function formatDayHeading(d: Date) {
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

export function monthGrid(view: Date) {
  const first = startOfMonth(view)
  const startOffset = (first.getDay() + 6) % 7
  const start = new Date(first)
  start.setDate(first.getDate() - startOffset)
  const cells: Date[] = []
  for (let i = 0; i < 42; i++) {
    const cell = new Date(start)
    cell.setDate(start.getDate() + i)
    cells.push(cell)
  }
  return cells
}

export function formatTimeFromIcs(value: string) {
  const compact = value.replace(/[^0-9]/g, '')
  if (compact.length >= 12) {
    return `${compact.slice(8, 10)}:${compact.slice(10, 12)}`
  }
  return undefined
}

export function dateKeyFromIcs(value: string) {
  const compact = value.replace(/[^0-9]/g, '')
  if (compact.length >= 8) {
    return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`
  }
  return null
}
