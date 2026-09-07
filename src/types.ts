export type ItemKind = 'task' | 'deadline' | 'holiday'

export type ScheduleItem = {
  id: string
  date: string
  title: string
  done: boolean
  /** 月历点颜色：灰 task / 红 deadline / 绿 holiday，同一天可并存 */
  kind: ItemKind
  /** 无钟点的全天标注（可与红/灰/绿任意颜色组合） */
  allDay?: boolean
  /** @deprecated use start / end */
  time?: string
  start?: string
  end?: string
}

export type ScheduleMap = Record<string, ScheduleItem[]>
