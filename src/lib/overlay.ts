import type { ScheduleItem, ScheduleMap } from '../types'
import { replaceSchedule } from './backup'

const KEY = 'h2-schedule.overlay.v1'

export type Overlay = {
  done: Record<string, boolean>
  extra: ScheduleItem[]
  hidden: string[]
}

export function emptyOverlay(): Overlay {
  return { done: {}, extra: [], hidden: [] }
}

export function loadOverlay(): Overlay {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return emptyOverlay()
    const parsed = JSON.parse(raw) as Partial<Overlay>
    return {
      done: parsed.done && typeof parsed.done === 'object' ? parsed.done : {},
      extra: Array.isArray(parsed.extra) ? parsed.extra : [],
      hidden: Array.isArray(parsed.hidden) ? parsed.hidden : [],
    }
  } catch {
    return emptyOverlay()
  }
}

export function saveOverlay(overlay: Overlay) {
  localStorage.setItem(KEY, JSON.stringify(overlay))
}

export function overlayBusy(overlay: Overlay) {
  return overlay.extra.length > 0 || overlay.hidden.length > 0 || Object.keys(overlay.done).length > 0
}

export function applyOverlay(remote: ScheduleMap, overlay: Overlay): ScheduleMap {
  const hidden = new Set(overlay.hidden)
  const items: ScheduleItem[] = []
  for (const list of Object.values(remote)) {
    for (const item of list) {
      if (hidden.has(item.id)) continue
      items.push({
        ...item,
        done: Object.prototype.hasOwnProperty.call(overlay.done, item.id) ? overlay.done[item.id] : item.done,
      })
    }
  }
  for (const item of overlay.extra) {
    if (hidden.has(item.id)) continue
    items.push({
      ...item,
      done: overlay.done[item.id] ?? item.done,
    })
  }
  return replaceSchedule(items)
}
