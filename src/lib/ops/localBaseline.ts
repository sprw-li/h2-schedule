import type { ScheduleMap } from '../../types'
import type { Op } from './types'
import { project } from './fold'

/**
 * After flushOps clears the queue, fold those ops into the local snapshot
 * baseline so a lagging reducer pull cannot undo the user's ticks/edits.
 */
export function absorbFlushedOps(snapshot: ScheduleMap, flushed: Op[]): ScheduleMap {
  if (flushed.length === 0) return snapshot
  return project(snapshot, flushed)
}

/**
 * While waiting for the reducer to bump rev past the pre-flush baseline,
 * ignore remote snapshots at the same/older rev (they lack our flushed ops).
 * A higher remote rev means the fold caught up — safe to apply.
 */
export function shouldApplyRemoteSnapshot(opts: {
  remoteRev?: number
  optimisticUntilRev: number | null
}): 'apply' | 'keep-local' {
  const { remoteRev, optimisticUntilRev } = opts
  if (optimisticUntilRev == null) return 'apply'
  if (remoteRev != null && Number.isFinite(remoteRev) && remoteRev > optimisticUntilRev) {
    return 'apply'
  }
  return 'keep-local'
}
