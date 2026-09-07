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

export function addMonths(d: Date, delta: number) {
  return new Date(d.getFullYear(), d.getMonth() + delta, 1)
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
