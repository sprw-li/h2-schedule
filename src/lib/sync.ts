import type { ScheduleItem, ScheduleMap } from '../types'
import { flattenItems, replaceSchedule } from './backup'
import { normalizeSchedule, rowKey, scheduleContentSig, slotKey } from './schedule'

export {
  dedupeByIdentity,
  itemKey,
  instanceKey,
  slotKey,
  rowKey,
  normalizeSchedule,
  parseScheduleJsonText,
  serializeSchedule,
  scheduleContentSig,
} from './schedule'

const PENDING_KEY = 'h2-schedule.pending-sync'
const REMOTE_SHA_KEY = 'h2-schedule.remote-sha'
const REMOTE_SNAP_KEY = 'h2-schedule.remote-snap.v1'
const GH_SHA_KEY = 'h2-schedule.github-sha'
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

/**
 * 本机上次成功写入 GitHub 时拿到的 blob sha。
 * 镜像 GitHub 时只允许在 sha 与远端一致时写——拿不到或不匹配就放弃，
 * 绝不「重取最新 sha 再硬盖」（那是最后写赢，会冲掉别处刚改的数据）。
 */
export function saveGithubSha(sha: string) {
  try {
    if (sha) localStorage.setItem(GH_SHA_KEY, sha)
    else localStorage.removeItem(GH_SHA_KEY)
  } catch {
    /* ignore */
  }
}

export function loadGithubSha() {
  try {
    return localStorage.getItem(GH_SHA_KEY) ?? ''
  } catch {
    return ''
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
  _preferLocal: boolean,
): ScheduleItem | null {
  if (local && remote) {
    // 同一条已在本机：标题/时刻/勾选一律跟本机。远端优先会把刚改的 1220/血检盖回去。
    return {
      ...remote,
      ...local,
      done: local.done,
      id: local.id || remote.id,
      date: local.date,
    }
  }
  if (local) return { ...local }
  if (remote) return { ...remote }
  return null
}

/**
 * 只按「同日同 id」或「完全相同的一行」对齐。
 * 用下标标记已配对，避免 Map 把同课不同节次挤成一条、或同 slot 第二条被当成已处理而丢掉。
 * 不用科目族猜测「这还是那节课」——取消/调课会被猜回去。
 */
export function mergeByIdentity(
  remote: ScheduleMap,
  local: ScheduleMap,
  preferLocal: boolean,
  baseline: ScheduleMap | null = null,
): ScheduleMap {
  const remoteItems = flattenItems(remote)
  const localItems = flattenItems(local)
  const baselineItems = baseline ? flattenItems(baseline) : []
  const localSlots = new Set(localItems.map(slotKey))
  const remoteSlots = new Set(remoteItems.map(slotKey))
  const baselineSlots = new Set(baselineItems.map(slotKey))
  const localRows = new Set(localItems.map(rowKey))
  const remoteRows = new Set(remoteItems.map(rowKey))
  const baselineRows = new Set(baselineItems.map(rowKey))

  const usedR = new Set<number>()
  const usedL = new Set<number>()
  const out: ScheduleItem[] = []

  const remoteBySlot = new Map<string, number>()
  remoteItems.forEach((r, i) => {
    const k = slotKey(r)
    if (!remoteBySlot.has(k)) remoteBySlot.set(k, i)
  })

  localItems.forEach((l, li) => {
    const ri = remoteBySlot.get(slotKey(l))
    if (ri == null || usedR.has(ri) || usedL.has(li)) return
    usedR.add(ri)
    usedL.add(li)
    const r = remoteItems[ri]
    const m = pickMerged(r, l, preferLocal)
    if (m) out.push({ ...m, id: l.id || r.id, date: l.date })
  })

  const remoteByRow = new Map<string, number[]>()
  remoteItems.forEach((r, i) => {
    if (usedR.has(i)) return
    const k = rowKey(r)
    const arr = remoteByRow.get(k) ?? []
    arr.push(i)
    remoteByRow.set(k, arr)
  })

  localItems.forEach((l, li) => {
    if (usedL.has(li)) return
    const arr = remoteByRow.get(rowKey(l))
    if (!arr?.length) return
    const ri = arr.shift()!
    if (usedR.has(ri)) return
    usedR.add(ri)
    usedL.add(li)
    const m = pickMerged(remoteItems[ri], l, preferLocal)
    if (m) out.push({ ...m, id: l.id || remoteItems[ri].id, date: l.date })
  })

  localItems.forEach((l, li) => {
    if (usedL.has(li)) return
    usedL.add(li)
    const k = slotKey(l)
    const rk = rowKey(l)
    // 上一份云端有、这份没有：是删掉的，不要本机旧副本加回去
    // id 被 normalize 成 dup-… 时 slotKey 对不上，仍认整行 rowKey
    if (baseline && baselineSlots.has(k) && !remoteSlots.has(k)) return
    if (baseline && baselineRows.has(rk) && !remoteRows.has(rk)) return
    out.push({ ...l })
  })

  remoteItems.forEach((r, ri) => {
    if (usedR.has(ri)) return
    const k = slotKey(r)
    const rk = rowKey(r)
    if (preferLocal && baseline && baselineSlots.has(k) && !localSlots.has(k)) return
    if (preferLocal && baseline && baselineRows.has(rk) && !localRows.has(rk)) return
    usedR.add(ri)
    out.push({ ...r })
  })

  return normalizeSchedule(replaceSchedule(out))
}

export function localHasUnsyncedExtras(remote: ScheduleMap, local: ScheduleMap) {
  return localDiffersFromRemote(remote, local)
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
  const baseline = opts.baseline ?? loadRemoteSnap()
  const merged = normalizeSchedule(
    mergeByIdentity(remoteClean, localClean, opts.pending, baseline),
  )
  const needPush = localDiffersFromRemote(remoteClean, merged)
  return { merged, remoteClean, needPush }
}
