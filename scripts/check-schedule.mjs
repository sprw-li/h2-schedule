/**
 * 结构检查：能解析、id 不撞。不再用课表业务规则（周次/抽血/考查）改数据。
 * 另断言 public/schedule.json 与 docs/schedule.json 的 items 逐条一致，防止两份漂移。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const docsPath = join(root, 'docs', 'schedule.json')
const publicPath = join(root, 'public', 'schedule.json')

function load(path) {
  const data = JSON.parse(readFileSync(path, 'utf8'))
  if (!Array.isArray(data.items)) throw new Error(`${path} 需要 items 数组`)
  return data
}

const data = load(docsPath)
const ids = new Set()
const slots = new Set()
let dups = 0
let slotDups = 0
for (const it of data.items) {
  if (!it?.id || !it?.date || !it?.title) throw new Error('条目缺 id/date/title')
  if (ids.has(it.id)) dups += 1
  ids.add(it.id)
  const slot = `${it.date}|${it.id}`
  if (slots.has(slot)) slotDups += 1
  slots.add(slot)
}
if (slotDups) throw new Error(`同一天重复 id ${slotDups} 处（删改会对错行）`)

// public/ 是唯一编辑源，docs/ 是 App 唯一读写路径。两者 items 必须逐条相同。
const pub = load(publicPath)
const keyOf = (it) => `${it.date}|${it.start ?? ''}|${it.end ?? ''}|${it.title}`
const tally = (arr) => {
  const m = new Map()
  for (const it of arr) {
    const k = keyOf(it)
    m.set(k, (m.get(k) ?? 0) + 1)
  }
  return m
}
const pubMap = tally(pub.items)
const docsMap = tally(data.items)
const missing = [] // 只在 public 有 → docs 缺
const extra = [] // 只在 docs 有 → docs 多
for (const [k, n] of pubMap) {
  const d = docsMap.get(k) ?? 0
  for (let i = 0; i < n - d; i += 1) missing.push(k)
}
for (const [k, n] of docsMap) {
  const p = pubMap.get(k) ?? 0
  for (let i = 0; i < n - p; i += 1) extra.push(k)
}
if (missing.length || extra.length) {
  console.error(
    `check-schedule: FAIL — public/schedule.json (${pub.items.length} items) 与 docs/schedule.json (${data.items.length} items) 的 items 不一致`,
  )
  if (missing.length) console.error(`  docs 缺少 ${missing.length} 条（只在 public 有）:\n    ${missing.join('\n    ')}`)
  if (extra.length) console.error(`  docs 多出 ${extra.length} 条（只在 docs 有）:\n    ${extra.join('\n    ')}`)
  console.error('  修复：只改 public/schedule.json，然后跑 npm run build:pages 同步到 docs/')
  process.exit(1)
}

console.log(
  `check-schedule: ok (${data.items.length} items, public/docs in sync${dups ? `, ${dups} cross-day duplicate ids tolerated` : ''})`,
)
