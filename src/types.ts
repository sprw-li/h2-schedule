export type ItemKind = 'task' | 'deadline'

export type ScheduleItem = {
  id: string
  date: string
  title: string
  done: boolean
  kind: ItemKind
  time?: string
}

export type ScheduleMap = Record<string, ScheduleItem[]>
