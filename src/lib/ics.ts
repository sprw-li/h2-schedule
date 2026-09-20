import { flattenItems } from './backup'
import { isAllDay, parseDateKey, resolveTimes } from './dates'
import { normalizeSchedule } from './schedule'
import type { ScheduleMap } from '../types'

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function fold(line: string) {
  if (line.length <= 74) return line
  const chunks = [line.slice(0, 74)]
  for (let i = 74; i < line.length; i += 73) chunks.push(` ${line.slice(i, i + 73)}`)
  return chunks.join('\r\n')
}

function esc(text: string) {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

function ymd(key: string) {
  return key.replace(/-/g, '')
}

function nextDateKey(key: string) {
  const d = parseDateKey(key)
  d.setDate(d.getDate() + 1)
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
}

function hmStamp(hm: string) {
  const [h, m] = hm.split(':')
  return `${pad(Number(h))}${pad(Number(m))}00`
}

function utcNow() {
  const d = new Date()
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
}

/** 导出给系统日历；时刻按 Asia/Shanghai */
export function scheduleToIcs(map: ScheduleMap) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//H2 Schedule//CN',
    'CALSCALE:GREGORIAN',
    'X-WR-TIMEZONE:Asia/Shanghai',
  ]
  const stamp = utcNow()
  for (const item of flattenItems(normalizeSchedule(map))) {
    const title = item.title.trim()
    if (!title) continue
    lines.push('BEGIN:VEVENT')
    lines.push(`UID:${item.id}@h2-schedule`)
    lines.push(`DTSTAMP:${stamp}`)
    if (isAllDay(item)) {
      lines.push(`DTSTART;VALUE=DATE:${ymd(item.date)}`)
      lines.push(`DTEND;VALUE=DATE:${nextDateKey(item.date)}`)
    } else {
      const { start, end } = resolveTimes(item)
      const a = start || end || '00:00'
      const b = end || start || '00:00'
      lines.push(`DTSTART;TZID=Asia/Shanghai:${ymd(item.date)}T${hmStamp(a)}`)
      lines.push(`DTEND;TZID=Asia/Shanghai:${ymd(item.date)}T${hmStamp(b)}`)
    }
    lines.push(fold(`SUMMARY:${esc(title)}`))
    if (item.kind === 'deadline') lines.push('CATEGORIES:截止')
    if (item.kind === 'holiday') lines.push('CATEGORIES:假日')
    if (item.done) lines.push('STATUS:CONFIRMED')
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return `${lines.join('\r\n')}\r\n`
}
