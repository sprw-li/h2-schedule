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
  '血检',
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

function fnv1a(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/** 撞 id 时用内容生成稳定后缀，避免每次 normalize 都换新 UUID、触发无意义推送 */
function stableDupId(item: ScheduleItem, nth: number) {
  return `dup-${fnv1a(`${item.date}|${item.kind}|${item.title}|${item.start ?? ''}|${item.end ?? ''}|${nth}`)}`
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

export const BLOOD_CANON_TITLE = '血检——康复'

/** 抽血堆/空腹旧条。用户手写的「血检——康复」绝不能进这里，否则一保存就被改回去。 */
export function isBloodSpamTitle(title: string) {
  const t = title.trim()
  if (t.includes('康复')) return false
  return /抽血|不要吃早饭|勿进食|血脂|腰椎诊断|腰椎（|上午空腹/.test(t)
}

export function isBloodNoiseTitle(title: string) {
  return isBloodSpamTitle(title) || /血检/.test(title.trim())
}

export function isStaleBloodTitle(title: string) {
  return isBloodSpamTitle(title)
}

/** 化安只要第 6–14 周（学期从 2026-09-07 起算） */
export function isHuaAnOutOfRange(item: Pick<ScheduleItem, 'date' | 'title'>) {
  if (!item.title.includes('化学实验室安全技术')) return false
  const start = Date.parse('2026-09-07T00:00:00')
  const t = Date.parse(`${item.date}T00:00:00`)
  if (!Number.isFinite(start) || !Number.isFinite(t)) return false
  const week = Math.floor((t - start) / (7 * 86400000)) + 1
  return week < 6 || week > 14
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
    // 兼容脏存储：字符串 "true" / 数字 1
    done: o.done === true || o.done === 'true' || o.done === 1,
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

/** 同一 id 只能对应一条；重复则给后来者稳定新 id（防改一条串多条/串日） */
export function ensureUniqueIds(items: ScheduleItem[]): ScheduleItem[] {
  const seen = new Set<string>()
  let nth = 0
  return items.map((it) => {
    if (it.id && !seen.has(it.id)) {
      seen.add(it.id)
      return it
    }
    nth += 1
    let id = stableDupId(it, nth)
    while (seen.has(id)) {
      nth += 1
      id = stableDupId(it, nth)
    }
    seen.add(id)
    return { ...it, id }
  })
}

/** 不含 id：用来判断本机相对云端是否真有改动（改标题/时刻/勾选也要推） */
export function itemContentSig(item: ScheduleItem) {
  return [
    item.date,
    item.kind,
    item.title.trim(),
    item.start ?? '',
    item.end ?? '',
    item.allDay ? '1' : '0',
    item.done ? '1' : '0',
  ].join('\0')
}

export function scheduleContentSig(map: ScheduleMap) {
  return flattenItems(map)
    .map(itemContentSig)
    .sort()
    .join('\n')
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
  let sawSpam = false
  const kept: ScheduleItem[] = []
  for (const it of all) {
    if (isExamPileJunk(it)) continue
    if (isHuaAnOutOfRange(it)) continue
    if (isBloodSpamTitle(it.title)) {
      sawSpam = true
      bloodDone = bloodDone || !!it.done
      continue
    }
    // 云端已勾完的论文选题：本机旧 false 不得再点亮红点
    if (it.date === '2026-09-16' && it.title.includes('论文选题')) {
      kept.push({ ...it, done: true, kind: 'deadline' })
      continue
    }
    kept.push(it)
  }
  const bloodKept = kept.find((i) => i.date === '2026-09-12' && /血检/.test(i.title))
  if (bloodKept) {
    if (bloodDone) bloodKept.done = true
  } else if (sawSpam) {
    kept.push({
      id: 'blood-2026-09-12',
      date: '2026-09-12',
      title: BLOOD_CANON_TITLE,
      done: bloodDone,
      kind: 'task',
      start: '08:00',
      end: '11:00',
    })
  }
  return replaceSchedule(kept)
}

/** 唯一规范化入口：coerce → sanitize → dedupe → 唯一 id → 按 date 分桶 */
export function normalizeSchedule(input: ScheduleMap | ScheduleItem[] | unknown[]): ScheduleMap {
  const items = Array.isArray(input)
    ? coerceItems(input)
    : coerceItems(flattenItems(input as ScheduleMap) as unknown[])
  const cleaned = ensureUniqueIds(flattenItems(dedupeByIdentity(sanitizeNoise(replaceSchedule(items)))))
  return replaceSchedule(cleaned)
}

/** 序列化为可写入 GitHub / 本地的干净 JSON（真换行结尾） */
export function serializeSchedule(map: ScheduleMap): string {
  return `${JSON.stringify({ items: flattenItems(normalizeSchedule(map)) }, null, 2)}\n`
}
