/**
 * Bridge: legacy whole-table writes land on CLab / docs/schedule.json,
 * while P1 authority is h2-data ops + snapshot. When the public face has
 * item ids the snapshot lacks, turn those into create ops (ids preserved)
 * so the next flushOps() appends them to this device's op file.
 *
 * Never delete from "missing on public" — public may be stale.
 * Field edits on shared ids are left to normal commit(); this bridge
 * only imports ids the authority has never seen.
 */
import type { ScheduleItem, ScheduleMap } from '../../types'
import { flattenItems, replaceSchedule } from '../backup'
import type { DiffMeta } from './diff'
import type { Op } from './types'

function byId(map: ScheduleMap): Map<string, ScheduleItem> {
  const m = new Map<string, ScheduleItem>()
  for (const it of flattenItems(map)) m.set(it.id, it)
  return m
}

/** Union public faces by id (later maps overwrite earlier for the same id). */
export function unionSchedules(maps: ScheduleMap[]): ScheduleMap {
  const m = new Map<string, ScheduleItem>()
  for (const map of maps) {
    for (const it of flattenItems(map)) m.set(it.id, it)
  }
  return replaceSchedule([...m.values()] as never)
}

/**
 * Ids present on public but absent from authority snapshot → create ops.
 * Skips ids already queued as create/restore (idempotent catch-up).
 */
export function createOpsFromPublicAhead(
  authority: ScheduleMap,
  publicMap: ScheduleMap,
  meta: DiffMeta,
  pendingCreateIds?: Set<string>,
): Op[] {
  const known = byId(authority)
  const pub = byId(publicMap)
  const pending = pendingCreateIds ?? new Set<string>()
  const ops: Op[] = []

  for (const [id, item] of pub) {
    if (known.has(id) || pending.has(id)) continue
    ops.push({
      opId: meta.opId(),
      deviceId: meta.deviceId,
      clientSeq: meta.nextSeq(),
      hlc: meta.tickHlc(),
      type: 'create',
      payload: { ...item },
    })
  }
  return ops
}

export function pendingCreateOrRestoreIds(queue: Op[]): Set<string> {
  const s = new Set<string>()
  for (const op of queue) {
    if (op.type !== 'create' && op.type !== 'restore') continue
    const id = (op.payload as ScheduleItem | undefined)?.id
    if (id) s.add(id)
  }
  return s
}

/** Survives flush→reduce lag so we do not re-create the same public ids. */
export const CATCHUP_SEEN_KEY = 'h2-schedule.public-catchup-seen.v1'

export function loadCatchupSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(CATCHUP_SEEN_KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw) as unknown
    if (!Array.isArray(arr)) return new Set()
    return new Set(arr.filter((x): x is string => typeof x === 'string'))
  } catch {
    return new Set()
  }
}

export function rememberCatchupSeen(ids: string[]) {
  if (ids.length === 0) return
  const s = loadCatchupSeen()
  for (const id of ids) s.add(id)
  try {
    localStorage.setItem(CATCHUP_SEEN_KEY, JSON.stringify([...s]))
  } catch {
    /* quota */
  }
}

/** Drop ids that already appear in the authority snapshot. */
export function pruneCatchupSeen(authority: ScheduleMap) {
  const known = byId(authority)
  const s = loadCatchupSeen()
  let changed = false
  for (const id of [...s]) {
    if (known.has(id)) {
      s.delete(id)
      changed = true
    }
  }
  if (!changed) return
  try {
    if (s.size === 0) localStorage.removeItem(CATCHUP_SEEN_KEY)
    else localStorage.setItem(CATCHUP_SEEN_KEY, JSON.stringify([...s]))
  } catch {
    /* ignore */
  }
}

export function publicAheadCount(authority: ScheduleMap, publicMap: ScheduleMap): number {
  const known = byId(authority)
  let n = 0
  for (const id of byId(publicMap).keys()) {
    if (!known.has(id)) n++
  }
  return n
}
