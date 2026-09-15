import type { ScheduleItem, ScheduleMap } from '../types'
import { flattenItems, replaceSchedule } from './backup'
import {
  isHuaAnOutOfRange,
  isStaleBloodTitle,
  itemKey,
  normalizeSchedule,
  scheduleContentSig,
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
  scheduleContentSig,
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
    const titleLocal = local.title.trim()
    const titleRemote = remote.title.trim()
    const contentDiff =
      titleLocal !== titleRemote || local.start !== remote.start || local.end !== remote.end
    if (contentDiff) {
      // 本机已被过期化安盖住时，信云端替换项；其它手写改动一律保住本机
      if (isHuaAnOutOfRange(local) && !titleRemote.includes('化学实验室安全技术')) {
        return { ...remote, done: !!(local.done || remote.done), date: local.date, id: local.id || remote.id }
      }
      if (isStaleBloodTitle(titleLocal) && titleRemote.includes('康复')) {
        return { ...remote, done: !!(local.done || remote.done), date: local.date, id: local.id || remote.id }
      }
      return { ...local, done: !!(local.done || remote.done), date: local.date, id: local.id || remote.id }
    }
    const base = preferLocal ? local : remote
    return { ...base, done: !!(local.done || remote.done) }
  }
  if (local) return { ...local }
  if (remote) return { ...remote }
  return null
}

function slotKey(item: ScheduleItem) {
  return `${item.date}\0${item.start ?? ''}\0${item.end ?? ''}\0${item.allDay ? '1' : '0'}`
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
  const usedRemoteIds = new Set<string>()
  const usedLocalIds = new Set<string>()
  const out: ScheduleItem[] = []

  // 0. 同日同 id：改标题后 exact/soft key 都对不上，必须先按 id 接上，否则会变成「两条」或串到别的天
  const remoteById = new Map<string, ScheduleItem>()
  for (const r of remoteItems) {
    if (!remoteById.has(r.id)) remoteById.set(r.id, r)
  }
  for (const l of localItems) {
    const r = remoteById.get(l.id)
    if (!r || r.date !== l.date) continue
    if (usedLocal.has(itemKey(l)) || usedRemote.has(itemKey(r))) continue
    if (usedLocalIds.has(l.id) || usedRemoteIds.has(r.id)) continue
    usedRemote.add(itemKey(r))
    usedLocal.add(itemKey(l))
    usedRemoteIds.add(r.id)
    usedLocalIds.add(l.id)
    const m = pickMerged(r, l, preferLocal)
    if (m) out.push({ ...m, id: l.id || r.id, date: l.date })
  }

  for (const [ek, l] of localExact) {
    const r = remoteExact.get(ek)
    if (!r) continue
    if (usedLocal.has(ek) || usedRemote.has(itemKey(r))) continue
    if (usedLocalIds.has(l.id) || usedRemoteIds.has(r.id)) continue
    usedRemote.add(itemKey(r))
    usedLocal.add(ek)
    usedRemoteIds.add(r.id)
    usedLocalIds.add(l.id)
    const m = pickMerged(r, l, preferLocal)
    if (m) out.push(m)
  }

  for (const [sk, l] of localSoft) {
    if (usedLocal.has(itemKey(l)) || usedLocalIds.has(l.id)) continue
    const r = remoteSoft.get(sk)
    if (!r || usedRemote.has(itemKey(r)) || usedRemoteIds.has(r.id)) continue
    usedRemote.add(itemKey(r))
    usedLocal.add(itemKey(l))
    usedRemoteIds.add(r.id)
    usedLocalIds.add(l.id)
    const m = pickMerged(r, l, preferLocal)
    if (m) out.push(m)
  }

  for (const l of localItems) {
    if (usedLocal.has(itemKey(l)) || usedLocalIds.has(l.id)) continue
    usedLocal.add(itemKey(l))
    usedLocalIds.add(l.id)
    out.push({ ...l })
  }

  const localBySlot = new Map<string, ScheduleItem[]>()
  for (const l of localItems) {
    const k = slotKey(l)
    const arr = localBySlot.get(k) ?? []
    arr.push(l)
    localBySlot.set(k, arr)
  }

  for (const r of remoteItems) {
    if (usedRemote.has(itemKey(r)) || usedRemoteIds.has(r.id)) continue
    if (preferLocal && baseline && baselineSoft.has(softKey(r))) continue
    const localsAt = localBySlot.get(slotKey(r)) ?? []
    if (
      r.title.includes('化学实验室安全技术') &&
      localsAt.some((l) => !l.title.includes('化学实验室安全技术'))
    ) {
      continue
    }
    usedRemote.add(itemKey(r))
    usedRemoteIds.add(r.id)
    out.push({ ...r })
  }

  return normalizeSchedule(replaceSchedule(out))
}

export function localHasUnsyncedExtras(remote: ScheduleMap, local: ScheduleMap) {
  const remoteSoft = new Set(flattenItems(normalizeSchedule(remote)).map((i) => softKey(i)))
  return flattenItems(normalizeSchedule(local)).some((i) => !remoteSoft.has(softKey(i)))
}

/** 标题/时刻/勾选/删除都算未同步，不能只看「多出来的科目族」 */
export function localDiffersFromRemote(remote: ScheduleMap, local: ScheduleMap) {
  return scheduleContentSig(normalizeSchedule(local)) !== scheduleContentSig(normalizeSchedule(remote))
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
  const needPush = localDiffersFromRemote(remoteClean, merged)
  return { merged, remoteClean, needPush }
}
