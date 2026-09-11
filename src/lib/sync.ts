import type { ScheduleItem, ScheduleMap } from '../types'
import { flattenItems, replaceSchedule } from './backup'
import {
  itemKey,
  normalizeSchedule,
  softKey,
} from './schedule'

export {
  dedupeByIdentity,
  familyOf,
  itemKey,
  softKey,
  normalizeSchedule,
  sanitizeNoise as sanitizeScheduleNoise,
  isBloodNoiseTitle,
  isExamPileJunk,
  parseScheduleJsonText,
  serializeSchedule,
} from './schedule'

const PENDING_KEY = 'h2-schedule.pending-sync'
const REMOTE_SHA_KEY = 'h2-schedule.remote-sha'
const REMOTE_SNAP_KEY = 'h2-schedule.remote-snap.v1'
const LEGACY_OVERLAY_KEY = 'h2-schedule.overlay.v1'

export function setPendingSync(on: boolean) {
  try {
    if (on) localStorage.setItem(PENDING_KEY, '1')
    else localStorage.removeItem(PENDING_KEY)
  } catch {
    /* ignore */
  }
}

export function isPendingSync() {
  try {
    return localStorage.getItem(PENDING_KEY) === '1'
  } catch {
    return false
  }
}

export function saveRemoteSha(sha: string) {
  try {
    if (sha) localStorage.setItem(REMOTE_SHA_KEY, sha)
    else localStorage.removeItem(REMOTE_SHA_KEY)
  } catch {
    /* ignore */
  }
}

export function loadRemoteSha() {
  try {
    return localStorage.getItem(REMOTE_SHA_KEY) ?? ''
  } catch {
    return ''
  }
}

export function saveRemoteSnap(map: ScheduleMap) {
  try {
    localStorage.setItem(REMOTE_SNAP_KEY, JSON.stringify(normalizeSchedule(map)))
  } catch {
    /* ignore */
  }
}

export function loadRemoteSnap(): ScheduleMap | null {
  try {
    const raw = localStorage.getItem(REMOTE_SNAP_KEY)
    if (!raw) return null
    return normalizeSchedule(JSON.parse(raw) as ScheduleMap)
  } catch {
    return null
  }
}

export function clearLegacyOverlay() {
  try {
    localStorage.removeItem(LEGACY_OVERLAY_KEY)
  } catch {
    /* ignore */
  }
}

function pickMerged(
  remote: ScheduleItem | undefined,
  local: ScheduleItem | undefined,
  preferLocal: boolean,
): ScheduleItem | null {
  if (local && remote) {
    const base = preferLocal ? { ...local, id: remote.id } : { ...remote }
    return { ...base, done: !!(local.done || remote.done) }
  }
  if (local) return { ...local }
  if (remote) return { ...remote }
  return null
}

/**
 * 双端对齐合并：
 * 1. 本机独有保留（手写日程不丢）
 * 2. exact / soft key 对齐，done 取或
 * 3. preferLocal + baseline：本机删过的 soft key 不接回
 */
export function mergeByIdentity(
  remote: ScheduleMap,
  local: ScheduleMap,
  preferLocal: boolean,
  baseline: ScheduleMap | null = null,
): ScheduleMap {
  const remoteItems = flattenItems(remote)
  const localItems = flattenItems(local)
  const baselineSoft = new Set(
    baseline ? flattenItems(baseline).map((i) => softKey(i)) : [],
  )

  const remoteExact = new Map(remoteItems.map((i) => [itemKey(i), i]))
  const localExact = new Map(localItems.map((i) => [itemKey(i), i]))
  const remoteSoft = new Map<string, ScheduleItem>()
  const localSoft = new Map<string, ScheduleItem>()
  for (const i of remoteItems) {
    const k = softKey(i)
    if (!remoteSoft.has(k) || i.done) remoteSoft.set(k, i)
  }
  for (const i of localItems) {
    const k = softKey(i)
    if (!localSoft.has(k) || i.done) localSoft.set(k, i)
  }

  const usedRemote = new Set<string>()
  const usedLocal = new Set<string>()
  const out: ScheduleItem[] = []

  for (const [ek, l] of localExact) {
    const r = remoteExact.get(ek)
    if (!r) continue
    usedRemote.add(itemKey(r))
    usedLocal.add(ek)
    const m = pickMerged(r, l, preferLocal)
    if (m) out.push(m)
  }

  for (const [sk, l] of localSoft) {
    if (usedLocal.has(itemKey(l))) continue
    const r = remoteSoft.get(sk)
    if (!r || usedRemote.has(itemKey(r))) continue
    usedRemote.add(itemKey(r))
    usedLocal.add(itemKey(l))
    const m = pickMerged(r, l, preferLocal)
    if (m) out.push(m)
  }

  for (const l of localItems) {
    if (usedLocal.has(itemKey(l))) continue
    usedLocal.add(itemKey(l))
    out.push({ ...l })
  }

  for (const r of remoteItems) {
    if (usedRemote.has(itemKey(r))) continue
    if (preferLocal && baseline && baselineSoft.has(softKey(r))) continue
    usedRemote.add(itemKey(r))
    out.push({ ...r })
  }

  return normalizeSchedule(replaceSchedule(out))
}

export function localHasUnsyncedExtras(remote: ScheduleMap, local: ScheduleMap) {
  const remoteSoft = new Set(flattenItems(normalizeSchedule(remote)).map((i) => softKey(i)))
  return flattenItems(normalizeSchedule(local)).some((i) => !remoteSoft.has(softKey(i)))
}

export type IntegrateOpts = {
  pending: boolean
  baseline?: ScheduleMap | null
}

/** 拉云/轮询统一入口：两端 normalize → merge → 再 normalize */
export function integrateSchedules(
  remote: ScheduleMap,
  local: ScheduleMap,
  opts: IntegrateOpts,
): { merged: ScheduleMap; remoteClean: ScheduleMap; needPush: boolean } {
  const remoteClean = normalizeSchedule(remote)
  const localClean = normalizeSchedule(local)
  const merged = normalizeSchedule(
    mergeByIdentity(
      remoteClean,
      localClean,
      opts.pending,
      opts.pending ? (opts.baseline ?? null) : null,
    ),
  )
  const needPush = localHasUnsyncedExtras(remoteClean, merged)
  return { merged, remoteClean, needPush }
}
