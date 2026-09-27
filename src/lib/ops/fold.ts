/**
 * Pure fold — keep semantics in sync with h2-data/scripts/fold.mjs
 */
import type { ItemKind, ScheduleItem, ScheduleMap } from '../../types'
import { replaceSchedule } from '../backup'
import { compareHlc } from './hlc'
import type { FoldStatus, Hlc, Op } from './types'
import { FIELD_KEYS } from './types'

const KINDS = new Set<ItemKind>(['task', 'deadline', 'holiday'])
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

type Internal = ScheduleItem & { _ts?: Record<string, Hlc | null> }

function coerceItem(raw: unknown): ScheduleItem | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const date = String(o.date ?? '').trim()
  const title = String(o.title ?? '').trim()
  if (!DATE_RE.test(date) || !title) return null
  const kindRaw = String(o.kind ?? 'task') as ItemKind
  if (!KINDS.has(kindRaw)) return null
  const id = String(o.id ?? '').trim()
  if (!id) return null
  const item: ScheduleItem = {
    id,
    date,
    title,
    done: o.done === true || o.done === 'true' || o.done === 1,
    kind: kindRaw,
  }
  if (o.allDay === true) item.allDay = true
  const start = o.start != null && String(o.start).trim() ? String(o.start).trim() : undefined
  const end = o.end != null && String(o.end).trim() ? String(o.end).trim() : undefined
  const time = o.time != null && String(o.time).trim() ? String(o.time).trim() : undefined
  if (start) item.start = start
  else if (time) item.start = time
  if (end) item.end = end
  return item
}

function publicItem(row: Internal): ScheduleItem {
  const out: ScheduleItem = {
    id: row.id,
    date: row.date,
    title: row.title,
    done: !!row.done,
    kind: row.kind,
  }
  if (row.allDay) out.allDay = true
  if (row.start) out.start = row.start
  if (row.end) out.end = row.end
  return out
}

function emptyFieldTs(): Record<string, Hlc | null> {
  return Object.fromEntries(FIELD_KEYS.map((k) => [k, null]))
}

export type FoldResult = FoldStatus & {
  items: ScheduleItem[]
  deleted: Record<string, Hlc>
}

export function fold(ops: Op[], opts: { reducerWall?: number } = {}): FoldResult {
  const items = new Map<string, Internal>()
  const deleted = new Map<string, Hlc>()
  const seenOpIds = new Set<string>()
  const applied: string[] = []
  const duplicate: string[] = []
  const rejected: FoldStatus['rejected'] = []
  const conflicts: FoldStatus['conflicts'] = []
  const devices: FoldStatus['devices'] = {}
  const warnings: NonNullable<FoldStatus['warnings']> = []
  const reducerWall = opts.reducerWall ?? Date.now()

  const list = [...ops].sort((a, b) => {
    const c = compareHlc(a?.hlc, b?.hlc)
    if (c !== 0) return c
    return String(a?.opId ?? '').localeCompare(String(b?.opId ?? ''))
  })

  function noteDevice(op: Op) {
    const id = String(op.deviceId || op.hlc?.device || '').trim()
    if (!id || id === 'genesis') return
    const prev = devices[id] || { lastSeenWall: 0, lastSeq: 0 }
    devices[id] = {
      lastSeenWall: Math.max(prev.lastSeenWall, Number(op.hlc?.wall) || 0),
      lastSeq: Math.max(prev.lastSeq, Number(op.clientSeq) || 0),
    }
  }

  function applyCreate(op: Op, item: ScheduleItem) {
    if (deleted.has(item.id)) {
      rejected.push({ opId: op.opId, reason: 'deleted', itemId: item.id, hint: '该 id 已删除；要恢复请用 restore' })
      return
    }
    if (items.has(item.id)) {
      rejected.push({ opId: op.opId, reason: 'id_exists', itemId: item.id, hint: '该 id 已存在；要改字段请用 set' })
      return
    }
    const ts = emptyFieldTs()
    for (const k of FIELD_KEYS) ts[k] = op.hlc
    items.set(item.id, { ...item, _ts: ts })
    applied.push(op.opId)
  }

  for (const op of list) {
    if (!op?.opId || !op.type || !op.hlc) {
      rejected.push({ opId: op?.opId, reason: 'invalid', hint: '缺 opId/type/hlc' })
      continue
    }
    if (seenOpIds.has(op.opId)) {
      duplicate.push(op.opId)
      continue
    }
    seenOpIds.add(op.opId)
    noteDevice(op)
    const wall = Number(op.hlc.wall)
    if (Number.isFinite(wall) && Math.abs(wall - reducerWall) > 10 * 60 * 1000) {
      warnings.push({ kind: 'clock_skew', opId: op.opId, deviceId: op.deviceId, skewMs: wall - reducerWall })
    }

    switch (op.type) {
      case 'genesis': {
        const arr = Array.isArray((op.payload as { items?: unknown }).items)
          ? (op.payload as { items: unknown[] }).items
          : []
        for (const raw of arr) {
          const item = coerceItem(raw)
          if (!item) {
            rejected.push({ opId: op.opId, reason: 'invalid', hint: 'genesis 内有非法条目' })
            continue
          }
          if (items.has(item.id) || deleted.has(item.id)) {
            rejected.push({
              opId: op.opId,
              reason: deleted.has(item.id) ? 'deleted' : 'id_exists',
              itemId: item.id,
            })
            continue
          }
          const ts = emptyFieldTs()
          for (const k of FIELD_KEYS) ts[k] = op.hlc
          items.set(item.id, { ...item, _ts: ts })
        }
        applied.push(op.opId)
        break
      }
      case 'create': {
        const item = coerceItem(op.payload)
        if (!item) {
          rejected.push({ opId: op.opId, reason: 'invalid', hint: 'create payload 非法' })
          break
        }
        applyCreate(op, item)
        break
      }
      case 'set': {
        const payload = op.payload as { id?: string; fields?: Record<string, unknown> }
        const id = String(payload.id ?? '').trim()
        const fields = payload.fields
        if (!id || !fields || typeof fields !== 'object') {
          rejected.push({ opId: op.opId, reason: 'invalid', hint: 'set 需要 id 与 fields' })
          break
        }
        if (deleted.has(id)) {
          rejected.push({ opId: op.opId, reason: 'deleted', itemId: id, hint: '该 id 已删除；要恢复请用 restore' })
          break
        }
        const row = items.get(id)
        if (!row) {
          rejected.push({ opId: op.opId, reason: 'not_found', itemId: id, hint: '该 id 不存在；要新建请用 create' })
          break
        }
        for (const key of Object.keys(fields)) {
          if (!(FIELD_KEYS as readonly string[]).includes(key)) continue
          const prevTs = row._ts?.[key]
          if (prevTs && compareHlc(op.hlc, prevTs) <= 0) continue
          const val = fields[key]
          if (val === null || val === undefined) {
            if (key === 'allDay') delete row.allDay
            else if (key === 'start') delete row.start
            else if (key === 'end') delete row.end
            else if (key === 'title' || key === 'date' || key === 'kind') {
              /* keep required fields unless restored */
            }
          } else if (key === 'done') {
            row.done = val === true || val === 'true' || val === 1
          } else if (key === 'allDay') {
            if (val === true) row.allDay = true
            else delete row.allDay
          } else if (key === 'kind') {
            const k = String(val) as ItemKind
            if (KINDS.has(k)) row.kind = k
          } else if (key === 'date' || key === 'title' || key === 'start' || key === 'end') {
            ;(row as Record<string, unknown>)[key] = String(val).trim()
          }
          if (!row._ts) row._ts = emptyFieldTs()
          row._ts[key] = op.hlc
        }
        applied.push(op.opId)
        break
      }
      case 'delete': {
        const id = String((op.payload as { id?: string }).id ?? '').trim()
        if (!id) {
          rejected.push({ opId: op.opId, reason: 'invalid', hint: 'delete 需要 id' })
          break
        }
        if (items.has(id)) {
          items.delete(id)
          deleted.set(id, op.hlc)
          applied.push(op.opId)
        } else if (deleted.has(id)) {
          const prev = deleted.get(id)!
          if (compareHlc(op.hlc, prev) > 0) deleted.set(id, op.hlc)
        }
        break
      }
      case 'restore': {
        const payload = op.payload as ScheduleItem & { fields?: Record<string, unknown>; id?: string }
        let item: ScheduleItem | null = null
        if (payload.fields && payload.id) {
          const base = items.get(payload.id) || {
            id: payload.id,
            date: '',
            title: '',
            done: false,
            kind: 'task' as ItemKind,
          }
          item = coerceItem({ ...base, ...payload.fields, id: payload.id })
        } else {
          item = coerceItem(payload)
        }
        if (!item) {
          rejected.push({ opId: op.opId, reason: 'invalid', hint: 'restore 需要完整事项或 id+fields' })
          break
        }
        const delTs = deleted.get(item.id)
        if (delTs && compareHlc(op.hlc, delTs) <= 0) {
          conflicts.push({
            itemId: item.id,
            opId: op.opId,
            rule: 'delete_wins',
            winner: 'delete',
            lost: publicItem(item),
            at: op.hlc,
          })
          break
        }
        deleted.delete(item.id)
        if (items.has(item.id)) {
          const row = items.get(item.id)!
          Object.assign(row, item)
          const ts = emptyFieldTs()
          for (const k of FIELD_KEYS) ts[k] = op.hlc
          row._ts = ts
          applied.push(op.opId)
        } else {
          applyCreate(op, item)
        }
        break
      }
      default:
        rejected.push({ opId: op.opId, reason: 'invalid', hint: `未知 type` })
    }
  }

  const out = [...items.values()]
    .map(publicItem)
    .sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date)
      const ta = a.start ?? (a.allDay ? '99:99' : '00:00')
      const tb = b.start ?? (b.allDay ? '99:99' : '00:00')
      if (ta !== tb) return ta.localeCompare(tb)
      return a.title.localeCompare(b.title, 'zh')
    })

  return {
    items: out,
    deleted: Object.fromEntries([...deleted.entries()]),
    applied,
    duplicate,
    rejected,
    conflicts,
    devices,
    warnings,
  }
}

/** Optimistic project: snapshot map + pending queue ops. */
export function project(snapshot: ScheduleMap, queue: Op[]): ScheduleMap {
  const baseOps: Op[] = []
  // Snapshot is already folded; apply queue on top by treating snapshot items as genesis-like baseline.
  // Build synthetic create ops at wall=0 so queue HLCs always win.
  for (const it of Object.values(snapshot).flat()) {
    baseOps.push({
      opId: `snap-${it.id}`,
      deviceId: 'snapshot',
      clientSeq: 0,
      hlc: { wall: 0, counter: 0, device: 'snapshot' },
      type: 'create',
      payload: it,
    })
  }
  const { items } = fold([...baseOps, ...queue])
  return replaceSchedule(items)
}
