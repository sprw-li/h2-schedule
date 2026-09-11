import type { ItemKind, ScheduleItem, ScheduleMap } from '../types'
import { flattenItems, replaceSchedule } from './backup'

const KINDS = new Set<ItemKind>(['task', 'deadline', 'holiday'])
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const KIND_RANK: Record<ItemKind, number> = {
  deadline: 3,
  holiday: 2,
  task: 1,
}

/** 稳定身份：换 UUID 后仍能对上同一条事项 */
export function itemKey(item: Pick<ScheduleItem, 'date' | 'kind' | 'title'>) {
  return `${item.date}\0${item.kind}\0${item.title.trim()}`
}

/** 课表改名/换教室后仍能对上：日期+类型+科目族 */
const FAMILIES = [
  '理论与计算化学导论',
  '普通化学实验',
  '今日化学 happytime',
  '今日化学',
  '普通化学习题课',
  '普通化学',
  '高等数学(B)(一)',
  '计算概论(B)上机',
  '计算概论(B)',
  '化学实验室安全技术',
  '大学生思想文化素养',
  '英汉口译',
  '数学习题课',
  '博雅理学讲堂',
  '军事理论直播课',
  '组会',
  '论文选题',
  '论文提交',
  '图书馆讲座',
].sort((a, b) => b.length - a.length)

export function familyOf(title: string) {
  const t = title.trim()
  for (const f of FAMILIES) {
    if (t.includes(f)) return f
  }
  return t
}

export function softKey(item: Pick<ScheduleItem, 'date' | 'kind' | 'title'>) {
  return `${item.date}\0${item.kind}\0${familyOf(item.title)}`
}

function newId() {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

/** 容忍误写入的字面量 \\n / BOM / 尾部垃圾 */
export function parseScheduleJsonText(raw: string): { items: unknown[] } {
  let t = String(raw || '').replace(/^\uFEFF/, '').trim()
  while (t.endsWith('\\n') || t.endsWith('\\r\\n')) {
    t = t.endsWith('\\r\\n') ? t.slice(0, -4) : t.slice(0, -2)
    t = t.trimEnd()
  }
  const end = t.lastIndexOf('}')
  if (end >= 0) t = t.slice(0, end + 1)
  const parsed = JSON.parse(t) as { items?: unknown }
  return { items: Array.isArray(parsed.items) ? parsed.items : [] }
}

export function isBloodNoiseTitle(title: string) {
  return /抽血|不要吃早饭|勿进食|血脂|血检|腰椎诊断|腰椎（|上午空腹/.test(title.trim())
}

/** 12-28 无时刻考查堆等已知脏规则 */
export function isExamPileJunk(item: Pick<ScheduleItem, 'date' | 'title' | 'start' | 'end'>) {
  const t = item.title.trim()
  if (item.date === '2026-12-28') {
    if (t.includes('停课复习')) return false
    if (/考试/.test(t) && (item.start || item.end)) return false
    if (/考查/.test(t)) return true
  }
  if (item.date === '2027-01-05' && t.includes('普通化学习题课') && /考试|考查/.test(t)) return true
  if (item.date === '2026-11-18' && (t === '今日化学' || t === '今日化学导论')) return true
  return false
}

/** 把任意输入压成合法 ScheduleItem；缺字段则丢弃 */
export function coerceItem(raw: unknown): ScheduleItem | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const date = String(o.date ?? '').trim()
  const title = String(o.title ?? '').trim()
  if (!DATE_RE.test(date) || !title) return null
  const kindRaw = String(o.kind ?? 'task') as ItemKind
  const kind = KINDS.has(kindRaw) ? kindRaw : 'task'
  const start = o.start != null && String(o.start).trim() ? String(o.start).trim() : undefined
  const end = o.end != null && String(o.end).trim() ? String(o.end).trim() : undefined
  const time = o.time != null && String(o.time).trim() ? String(o.time).trim() : undefined
  const id = String(o.id ?? '').trim() || newId()
  const item: ScheduleItem = {
    id,
    date,
    title,
    done: o.done === true,
    kind,
  }
  if (o.allDay === true) item.allDay = true
  if (start) item.start = start
  else if (time) item.start = time
  if (end) item.end = end
  return item
}

export function coerceItems(raw: unknown[]): ScheduleItem[] {
  const out: ScheduleItem[] = []
  for (const r of raw) {
    const it = coerceItem(r)
    if (it) out.push(it)
  }
  return out
}

/**
 * exact key 去重；再按同日同标题压掉 deadline+task 双份。
 * 不按科目族压条——同日多场讲座会丢。
 */
export function dedupeByIdentity(map: ScheduleMap): ScheduleMap {
  const byExact = new Map<string, ScheduleItem>()
  for (const it of flattenItems(map)) {
    const k = itemKey(it)
    const prev = byExact.get(k)
    if (!prev) {
      byExact.set(k, { ...it })
      continue
    }
    byExact.set(k, {
      ...prev,
      ...it,
      id: prev.id || it.id,
      done: !!(prev.done || it.done),
    })
  }

  const byTitle = new Map<string, ScheduleItem>()
  for (const it of byExact.values()) {
    const k = `${it.date}\0${it.title.trim()}`
    const prev = byTitle.get(k)
    if (!prev) {
      byTitle.set(k, it)
      continue
    }
    const prefer =
      KIND_RANK[it.kind] > KIND_RANK[prev.kind]
        ? it
        : KIND_RANK[it.kind] < KIND_RANK[prev.kind]
          ? prev
          : it.title.length >= prev.title.length
            ? it
            : prev
    const other = prefer === it ? prev : it
    byTitle.set(k, {
      ...prefer,
      id: prefer.id || other.id,
      done: !!(prefer.done || other.done),
      start: prefer.start || other.start,
      end: prefer.end || other.end,
    })
  }

  return replaceSchedule([...byTitle.values()])
}

export function sanitizeNoise(map: ScheduleMap): ScheduleMap {
  const all = flattenItems(map)
  let bloodDone = false
  let sawBlood = false
  const kept: ScheduleItem[] = []
  for (const it of all) {
    if (isExamPileJunk(it)) continue
    if (isBloodNoiseTitle(it.title)) {
      sawBlood = true
      bloodDone = bloodDone || !!it.done
      continue
    }
    kept.push(it)
  }
  if (sawBlood) {
    kept.push({
      id: 'blood-2026-09-12',
      date: '2026-09-12',
      title: '血检+腰椎诊断（上午空腹）',
      done: bloodDone,
      kind: 'task',
      start: '08:00',
      end: '11:00',
    })
  }
  return replaceSchedule(kept)
}

/** 唯一规范化入口：coerce → sanitize → dedupe → 按 date 分桶 */
export function normalizeSchedule(input: ScheduleMap | ScheduleItem[] | unknown[]): ScheduleMap {
  const items = Array.isArray(input)
    ? coerceItems(input)
    : coerceItems(flattenItems(input as ScheduleMap) as unknown[])
  return dedupeByIdentity(sanitizeNoise(replaceSchedule(items)))
}

/** 序列化为可写入 GitHub / 本地的干净 JSON（真换行结尾） */
export function serializeSchedule(map: ScheduleMap): string {
  return `${JSON.stringify({ items: flattenItems(normalizeSchedule(map)) }, null, 2)}\n`
}
