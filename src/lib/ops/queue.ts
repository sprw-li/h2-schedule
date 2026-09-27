import type { ScheduleMap } from '../../types'
import { flattenItems, replaceSchedule } from '../backup'
import { HlcClock } from './hlc'
import type { Op, OpQueueState } from './types'
import { DEVICE_ID_KEY, OPQUEUE_KEY, SNAPSHOT_KEY } from './types'

function newId() {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return `op-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function getOrCreateDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY)
    if (existing) return existing
    const id = `dev-${newId().replace(/-/g, '').slice(0, 12)}`
    localStorage.setItem(DEVICE_ID_KEY, id)
    return id
  } catch {
    return `dev-temp-${Date.now().toString(16)}`
  }
}

export function loadQueue(): OpQueueState {
  const deviceId = getOrCreateDeviceId()
  try {
    const raw = localStorage.getItem(OPQUEUE_KEY)
    if (!raw) {
      return { proto: 2, deviceId, nextSeq: 1, fileSha: {}, queue: [] }
    }
    const parsed = JSON.parse(raw) as OpQueueState
    if (parsed.proto !== 2 || !Array.isArray(parsed.queue)) {
      return { proto: 2, deviceId, nextSeq: 1, fileSha: {}, queue: [] }
    }
    return {
      proto: 2,
      deviceId: parsed.deviceId || deviceId,
      nextSeq: Number(parsed.nextSeq) || 1,
      fileSha: parsed.fileSha || {},
      queue: parsed.queue,
      snapshotRev: parsed.snapshotRev,
    }
  } catch {
    return { proto: 2, deviceId, nextSeq: 1, fileSha: {}, queue: [] }
  }
}

export function saveQueue(state: OpQueueState) {
  try {
    localStorage.setItem(OPQUEUE_KEY, JSON.stringify(state))
  } catch {
    /* quota */
  }
}

export function loadSnapshotMap(): ScheduleMap | null {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY)
    if (!raw) return null
    const items = JSON.parse(raw) as ScheduleMap | { items: unknown[] }
    if (items && typeof items === 'object' && !Array.isArray(items) && !('items' in items)) {
      return items as ScheduleMap
    }
    if (items && typeof items === 'object' && Array.isArray((items as { items: unknown[] }).items)) {
      return replaceSchedule((items as { items: Parameters<typeof replaceSchedule>[0] }).items as never)
    }
    return null
  } catch {
    return null
  }
}

export function saveSnapshotMap(map: ScheduleMap, rev?: number) {
  try {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(map))
    if (rev != null) {
      const q = loadQueue()
      q.snapshotRev = rev
      saveQueue(q)
    }
  } catch {
    /* ignore */
  }
}

export function queueByteSize(state: OpQueueState) {
  return new TextEncoder().encode(JSON.stringify(state.queue)).length
}

export function enqueueOps(ops: Op[]): OpQueueState {
  const state = loadQueue()
  state.queue.push(...ops)
  saveQueue(state)
  return state
}

export function removeOpIds(opIds: string[]): OpQueueState {
  const drop = new Set(opIds)
  const state = loadQueue()
  state.queue = state.queue.filter((op) => !drop.has(op.opId))
  saveQueue(state)
  return state
}

export function makeDiffMeta(clock: HlcClock, state: OpQueueState) {
  return {
    opId: () => newId(),
    deviceId: state.deviceId,
    nextSeq: () => {
      const n = state.nextSeq
      state.nextSeq = n + 1
      return n
    },
    tickHlc: () => clock.tick(),
  }
}

export function syncClockFromQueue(clock: HlcClock, state: OpQueueState) {
  for (const op of state.queue) {
    if (op.hlc) clock.observe(op.hlc)
  }
}

export function currentMonthKey(d = new Date()) {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

export function mapFromItems(items: { id: string; date: string }[]) {
  return replaceSchedule(items as never)
}

export function itemCount(map: ScheduleMap) {
  return flattenItems(map).length
}
