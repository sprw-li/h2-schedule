import type { ScheduleItem, ScheduleMap } from '../../types'
import { flattenItems } from '../backup'
import type { Op, OpPayloadSet } from './types'
import { FIELD_KEYS } from './types'
import type { Hlc } from './types'

function byId(map: ScheduleMap): Map<string, ScheduleItem> {
  const m = new Map<string, ScheduleItem>()
  for (const it of flattenItems(map)) m.set(it.id, it)
  return m
}

function fieldVal(it: ScheduleItem, key: (typeof FIELD_KEYS)[number]): unknown {
  if (key === 'allDay') return it.allDay === true ? true : null
  if (key === 'start') return it.start ?? null
  if (key === 'end') return it.end ?? null
  if (key === 'done') return !!it.done
  if (key === 'date') return it.date
  if (key === 'title') return it.title
  if (key === 'kind') return it.kind
  return null
}

function sameField(a: unknown, b: unknown) {
  if (a === b) return true
  if (a == null && b == null) return true
  return String(a) === String(b)
}

export type DiffMeta = {
  opId: () => string
  deviceId: string
  nextSeq: () => number
  tickHlc: () => Hlc
}

/**
 * Diff two schedule maps by id → create / set / delete ops.
 * Undo of a delete becomes restore when the item is re-added with the same id.
 */
export function diffById(prev: ScheduleMap, next: ScheduleMap, meta: DiffMeta): Op[] {
  const a = byId(prev)
  const b = byId(next)
  const ops: Op[] = []

  for (const [id, item] of b) {
    if (!a.has(id)) {
      ops.push({
        opId: meta.opId(),
        deviceId: meta.deviceId,
        clientSeq: meta.nextSeq(),
        hlc: meta.tickHlc(),
        type: 'create',
        payload: { ...item },
      })
      continue
    }
    const old = a.get(id)!
    const fields: OpPayloadSet['fields'] = {}
    let changed = false
    for (const key of FIELD_KEYS) {
      const ov = fieldVal(old, key)
      const nv = fieldVal(item, key)
      if (!sameField(ov, nv)) {
        ;(fields as Record<string, unknown>)[key] = nv
        changed = true
      }
    }
    if (changed) {
      ops.push({
        opId: meta.opId(),
        deviceId: meta.deviceId,
        clientSeq: meta.nextSeq(),
        hlc: meta.tickHlc(),
        type: 'set',
        payload: { id, fields },
      })
    }
  }

  for (const [id] of a) {
    if (!b.has(id)) {
      ops.push({
        opId: meta.opId(),
        deviceId: meta.deviceId,
        clientSeq: meta.nextSeq(),
        hlc: meta.tickHlc(),
        type: 'delete',
        payload: { id },
      })
    }
  }

  return ops
}

/**
 * When undo re-adds a previously deleted id, prefer restore over create
 * if we know the id was deleted in the pending queue / snapshot.
 */
export function upgradeCreatesToRestore(ops: Op[], deletedIds: Set<string>): Op[] {
  return ops.map((op) => {
    if (op.type !== 'create') return op
    const id = (op.payload as ScheduleItem).id
    if (!deletedIds.has(id)) return op
    return { ...op, type: 'restore', payload: op.payload }
  })
}
