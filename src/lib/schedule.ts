import type { ItemKind, ScheduleItem, ScheduleMap } from '../types'
import { flattenItems, replaceSchedule } from './backup'

const KINDS = new Set<ItemKind>(['task', 'deadline', 'holiday'])
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** 稳定身份：同日同类型同标题（CSV 对齐用，不含时刻） */
export function itemKey(item: Pick<ScheduleItem, 'date' | 'kind' | 'title'>) {
  return `${item.date}\0${item.kind}\0${item.title.trim()}`
}

/** 同一天里的一条：normalize 后 date+id 唯一。删改只认这个，避免同课不同节次互撞。 */
export function slotKey(item: Pick<ScheduleItem, 'date' | 'id'>) {
  return `${item.date}|${item.id}`
}

/** @deprecated 与 slotKey 相同；留给旧调用 */
export function instanceKey(item: Pick<ScheduleItem, 'date' | 'id'>) {
  return slotKey(item)
}

/** 真重复：连时刻也相同才压条。同课不同节次必须保留。 */
export function rowKey(item: ScheduleItem) {
  return [
    item.date,
    item.kind,
    item.title.trim(),
    item.start ?? '',
    item.end ?? '',
    item.allDay ? '1' : '0',
  ].join('\0')
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

/** 同一天同一 id 只能一条；跨天允许相同 id。撞了就给后来者稳定新 id。 */
export function ensureUniqueIds(items: ScheduleItem[]): ScheduleItem[] {
  const seen = new Set<string>()
  // 每个「date|原 id」各自计数：无关条目增删不会推移别处的 dup- 后缀。
  // 用全表共用计数器时，只要别处多/少一条重复项，后面所有 dup- id 都会跟着变（id 漂移）。
  const nthBySlot = new Map<string, number>()
  return items.map((it) => {
    const slot = `${it.date}|${it.id}`
    if (it.id && !seen.has(slot)) {
      seen.add(slot)
      return it
    }
    let nth = nthBySlot.get(slot) ?? 0
    let id: string
    do {
      nth += 1
      id = stableDupId(it, nth)
    } while (seen.has(`${it.date}|${id}`))
    nthBySlot.set(slot, nth)
    seen.add(`${it.date}|${id}`)
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

/** 只压完全相同的行，不按科目名/周次/「像不像课表」删改 */
export function dedupeByIdentity(map: ScheduleMap): ScheduleMap {
  const byRow = new Map<string, ScheduleItem>()
  for (const it of flattenItems(map)) {
    const k = rowKey(it)
    const prev = byRow.get(k)
    if (!prev) {
      byRow.set(k, { ...it })
      continue
    }
    byRow.set(k, {
      ...prev,
      ...it,
      id: prev.id || it.id,
      done: !!(prev.done || it.done),
    })
  }
  return replaceSchedule([...byRow.values()])
}

/** 「理论与计算化学导论 · 理教410」相对「……（杨立江）· 机房」的课名前缀 */
function courseHead(title: string) {
  return title.trim().split(/[·（]/)[0].replace(/\s+/g, ' ').trim()
}

function sameSlot(a: ScheduleItem, b: ScheduleItem) {
  return (
    a.date === b.date &&
    (a.start ?? '') === (b.start ?? '') &&
    (a.end ?? '') === (b.end ?? '') &&
    !!a.allDay === !!b.allDay
  )
}

function coversTitle(specific: string, generic: string) {
  const s = specific.trim()
  const g = generic.trim()
  if (!s || !g || s === g) return false
  if (s.startsWith(g)) return true
  const hs = courseHead(s)
  const hg = courseHead(g)
  if (!hs || !hg) return false
  if (hs === hg && s.length > g.length) return true
  return hs.startsWith(hg) && s.length > g.length
}

/**
 * 同一天同一时刻：骨架课名被更具体的一条盖住就丢掉。
 *
 * **不在 normalize / 同步路径上**。同一时段两条不同事项是正常的（如「拿书」+「血检」），
 * 静默删数据、且 done 取「或」会让取消勾选永远赢不了。保留此函数仅供导入时的
 * 可选提示使用；任何调用都必须让用户可见地确认，不得静默删。
 */
export function collapseCoveredDuplicates(map: ScheduleMap): ScheduleMap {
  const items = flattenItems(map).map((it) => ({ ...it }))
  const drop = new Set<number>()
  for (let i = 0; i < items.length; i++) {
    for (let j = 0; j < items.length; j++) {
      if (i === j || drop.has(i)) continue
      const a = items[i]
      const b = items[j]
      if (!sameSlot(a, b)) continue
      if (!coversTitle(b.title, a.title)) continue
      items[j] = { ...b, done: !!(a.done || b.done) }
      drop.add(i)
    }
  }
  return replaceSchedule(items.filter((_, idx) => !drop.has(idx)))
}

/** 入口：合法化字段 + 撞 id 处理。不做课表规则核验，也不静默删同段不同事项。 */
export function normalizeSchedule(input: ScheduleMap | ScheduleItem[] | unknown[]): ScheduleMap {
  const items = Array.isArray(input)
    ? coerceItems(input)
    : coerceItems(flattenItems(input as ScheduleMap) as unknown[])
  return replaceSchedule(
    ensureUniqueIds(flattenItems(dedupeByIdentity(replaceSchedule(items)))),
  )
}

/** 序列化为可写入 GitHub / 本地的干净 JSON（真换行结尾） */
export function serializeSchedule(map: ScheduleMap): string {
  return `${JSON.stringify({ items: flattenItems(normalizeSchedule(map)) }, null, 2)}\n`
}
