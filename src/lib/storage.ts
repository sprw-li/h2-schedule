import type { ScheduleItem, ScheduleMap } from '../types'
import { normalizeSchedule } from './schedule'

const KEY = 'h2-schedule.v1'

function uid() {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  if (c && typeof c.getRandomValues === 'function') {
    const buf = new Uint8Array(16)
    c.getRandomValues(buf)
    buf[6] = (buf[6] & 0x0f) | 0x40
    buf[8] = (buf[8] & 0x3f) | 0x80
    const hex = [...buf].map((b) => b.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function loadSchedule(): ScheduleMap {
  try {
    localStorage.removeItem('h2-schedule.done-titles.v1')
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as ScheduleMap
    if (!parsed || typeof parsed !== 'object') return {}
    return normalizeSchedule(parsed)
  } catch {
    return {}
  }
}

export function saveSchedule(map: ScheduleMap) {
  localStorage.setItem(KEY, JSON.stringify(normalizeSchedule(map)))
}

export function resetSchedule() {
  try {
    localStorage.removeItem(KEY)
    localStorage.removeItem('h2-schedule.done-titles.v1')
  } catch {
    /* ignore */
  }
}

export function mergeItems(map: ScheduleMap, incoming: ScheduleItem[]): ScheduleMap {
  const next: ScheduleMap = { ...map }
  for (const item of incoming) {
    const list = next[item.date] ? [...next[item.date]] : []
    const dup = list.some(
      (x) =>
        x.title === item.title &&
        x.kind === item.kind &&
        (x.start ?? x.time) === (item.start ?? item.time) &&
        (x.end ?? '') === (item.end ?? ''),
    )
    if (!dup) list.push(item)
    next[item.date] = list
  }
  return normalizeSchedule(next)
}

export { uid }
