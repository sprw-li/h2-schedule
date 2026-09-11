/**
 * 无框架冒烟：脏 JSON / 抽血 / 12-28 考查 / 双 kind 必须被 normalize 掉。
 * 用动态 import 跑编译前的 TS 等价逻辑的精简副本（与 src/lib/schedule.ts 规则对齐）。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// 直接读已写出的 schedule 模块：先 tsc 或用 vite-node 不现实；这里内联同规则做断言，
// 并额外用 node 跑一份从 dist 不可用 → 改为 spawn tsx？项目无 tsx。
// 方案：复制核心规则为纯 JS 校验 + 对 docs/schedule.json 做结构检查。

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const KINDS = new Set(['task', 'deadline', 'holiday'])
const KIND_RANK = { deadline: 3, holiday: 2, task: 1 }

function itemKey(i) {
  return `${i.date}\0${i.kind}\0${i.title.trim()}`
}

function isBloodNoiseTitle(title) {
  return /抽血|不要吃早饭|勿进食|血脂|血检|腰椎诊断|腰椎（|上午空腹/.test(String(title).trim())
}

function isExamPileJunk(item) {
  const t = String(item.title || '').trim()
  if (item.date === '2026-12-28') {
    if (t.includes('停课复习')) return false
    if (/考试/.test(t) && (item.start || item.end)) return false
    if (/考查/.test(t)) return true
  }
  if (item.date === '2027-01-05' && t.includes('普通化学习题课') && /考试|考查/.test(t)) return true
  if (item.date === '2026-11-18' && (t === '今日化学' || t === '今日化学导论')) return true
  return false
}

function coerceItem(raw) {
  if (!raw || typeof raw !== 'object') return null
  const date = String(raw.date ?? '').trim()
  const title = String(raw.title ?? '').trim()
  if (!DATE_RE.test(date) || !title) return null
  const kind = KINDS.has(raw.kind) ? raw.kind : 'task'
  return {
    id: String(raw.id || `id-${Math.random()}`),
    date,
    title,
    done: raw.done === true,
    kind,
    start: raw.start || undefined,
    end: raw.end || undefined,
  }
}

function flatten(map) {
  return Object.values(map).flat()
}

function replaceSchedule(items) {
  const map = {}
  for (const it of items) {
    if (!it?.date || !it?.title) continue
    ;(map[it.date] ??= []).push(it)
  }
  return map
}

function dedupe(map) {
  const byExact = new Map()
  for (const it of flatten(map)) {
    const k = itemKey(it)
    const prev = byExact.get(k)
    if (!prev) byExact.set(k, { ...it })
    else
      byExact.set(k, {
        ...prev,
        ...it,
        id: prev.id || it.id,
        done: !!(prev.done || it.done),
      })
  }
  const byTitle = new Map()
  for (const it of byExact.values()) {
    const k = `${it.date}\0${it.title.trim()}`
    const prev = byTitle.get(k)
    if (!prev) {
      byTitle.set(k, it)
      continue
    }
    const prefer = (KIND_RANK[it.kind] || 0) >= (KIND_RANK[prev.kind] || 0) ? it : prev
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

function sanitize(map) {
  let bloodDone = false
  let sawBlood = false
  const kept = []
  for (const it of flatten(map)) {
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

function normalize(input) {
  const items = Array.isArray(input)
    ? input.map(coerceItem).filter(Boolean)
    : flatten(input).map(coerceItem).filter(Boolean)
  return dedupe(sanitize(replaceSchedule(items)))
}

function parseScheduleJsonText(raw) {
  let t = String(raw || '').replace(/^\uFEFF/, '').trim()
  while (t.endsWith('\\n') || t.endsWith('\\r\\n')) {
    t = t.endsWith('\\r\\n') ? t.slice(0, -4) : t.slice(0, -2)
    t = t.trimEnd()
  }
  const end = t.lastIndexOf('}')
  if (end >= 0) t = t.slice(0, end + 1)
  const parsed = JSON.parse(t)
  return { items: Array.isArray(parsed.items) ? parsed.items : [] }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

// 1) dirty JSON trailer
{
  const dirty = '{\n  "items": [{"id":"1","date":"2026-09-12","title":"抽血，不要吃早饭！","done":false,"kind":"task"}]\n}\\n'
  const { items } = parseScheduleJsonText(dirty)
  const map = normalize(items)
  const list = flatten(map)
  assert(list.length === 1, 'blood should collapse to 1')
  assert(list[0].date === '2026-09-12', 'blood date')
  assert(list[0].title === '血检+腰椎诊断（上午空腹）', 'blood title')
}

// 2) 12-28 pile
{
  const items = [
    { id: 'a', date: '2026-12-28', title: '停课复习考试（至 1 月 10 日）', kind: 'deadline', done: false },
    { id: 'b', date: '2026-12-28', title: '高等数学(B)(一) 考试', kind: 'deadline', done: false, end: '21:30' },
    { id: 'c', date: '2026-12-28', title: '今日化学 考查', kind: 'deadline', done: false },
    { id: 'd', date: '2026-12-28', title: '英汉口译 考查', kind: 'deadline', done: false },
  ]
  const list = flatten(normalize(items))
  assert(list.length === 2, `12-28 should be 2 got ${list.length}`)
  assert(
    list.every((i) => i.title.includes('停课复习') || i.title.includes('高等数学')),
    '12-28 titles',
  )
}

// 3) deadline+task twin
{
  const items = [
    {
      id: 'same',
      date: '2026-12-12',
      title: '四级考试笔试',
      kind: 'deadline',
      done: false,
      start: '09:00',
      end: '11:20',
    },
    {
      id: 'same',
      date: '2026-12-12',
      title: '四级考试笔试',
      kind: 'task',
      done: false,
      start: '09:00',
      end: '11:20',
    },
  ]
  const list = flatten(normalize(items))
  assert(list.length === 1, 'cet twin')
  assert(list[0].kind === 'deadline', 'prefer deadline')
}

// 4) live docs file structure
{
  const raw = readFileSync(join(root, 'docs/schedule.json'), 'utf8')
  JSON.parse(raw) // must be native-clean
  const { items } = parseScheduleJsonText(raw)
  const map = normalize(items)
  const d28 = flatten(map).filter((i) => i.date === '2026-12-28')
  assert(d28.length === 2, `docs 12-28 count ${d28.length}`)
  const blood = flatten(map).filter((i) => isBloodNoiseTitle(i.title) || i.title.includes('血检'))
  assert(blood.length === 1 && blood[0].date === '2026-09-12', 'docs blood')
}

console.log('check-schedule: ok')
