export type ItemKind = 'task' | 'deadline'

export type ScheduleItem = {
  id: string
  date: string
  title: string
  done: boolean
  kind: ItemKind
  /** @deprecated use start / end */
  time?: string
  start?: string
  end?: string
}

export type ScheduleMap = Record<string, ScheduleItem[]>
