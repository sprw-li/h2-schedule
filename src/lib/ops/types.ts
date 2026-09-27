import type { ItemKind, ScheduleItem } from '../../types'

export type Hlc = {
  wall: number
  counter: number
  device: string
}

export type OpType = 'create' | 'set' | 'delete' | 'restore' | 'genesis'

export type OpPayloadCreate = ScheduleItem
export type OpPayloadSet = {
  id: string
  fields: Partial<{
    date: string | null
    title: string | null
    done: boolean | null
    kind: ItemKind | null
    start: string | null
    end: string | null
    allDay: boolean | null
  }>
}
export type OpPayloadDelete = { id: string }
export type OpPayloadRestore = ScheduleItem | OpPayloadSet
export type OpPayloadGenesis = { items: ScheduleItem[] }

export type Op = {
  opId: string
  deviceId: string
  clientSeq: number
  hlc: Hlc
  type: OpType
  payload: OpPayloadCreate | OpPayloadSet | OpPayloadDelete | OpPayloadRestore | OpPayloadGenesis
}

export type OpQueueState = {
  proto: 2
  deviceId: string
  nextSeq: number
  fileSha: Record<string, string>
  queue: Op[]
  /** last known reducer snapshot items as ScheduleMap JSON */
  snapshotRev?: number
}

export type FoldStatus = {
  applied: string[]
  duplicate: string[]
  rejected: Array<{ opId?: string; reason: string; itemId?: string; hint?: string }>
  conflicts: Array<Record<string, unknown>>
  devices: Record<string, { lastSeenWall: number; lastSeq: number; label?: string; skewMs?: number }>
  warnings?: Array<Record<string, unknown>>
}

export const DEVICE_ID_KEY = 'h2-schedule.device-id.v2'
export const OPQUEUE_KEY = 'h2-schedule.opqueue.v2'
export const SNAPSHOT_KEY = 'h2-schedule.reducer-snap.v2'
export const FIELD_KEYS = ['date', 'title', 'done', 'kind', 'start', 'end', 'allDay'] as const
