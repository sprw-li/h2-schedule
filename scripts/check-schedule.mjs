/**
 * 结构检查：能解析、同日 id 不撞。
 * P1：docs/schedule.json 是 reducer 物化快照的公开面（只读派生）；
 * public/schedule.json 仍可作为人工编辑种子。二者不再强制逐条一致——
 * 若存在 sibling h2-data/snapshot/schedule.json，则断言 docs ≡ snapshot。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const docsPath = join(root, 'docs', 'schedule.json')
const publicPath = join(root, 'public', 'schedule.json')
const dataSnap = join(root, '..', 'h2-data', 'snapshot', 'schedule.json')

function load(path) {
  const data = JSON.parse(readFileSync(path, 'utf8'))
  if (!Array.isArray(data.items)) throw new Error(`${path} 需要 items 数组`)
  return data
}

function keyOf(it) {
  return `${it.id}|${it.date}|${it.start ?? ''}|${it.end ?? ''}|${it.title}|${it.kind}|${it.done ? 1 : 0}|${it.allDay ? 1 : 0}`
}

const data = load(docsPath)
const ids = new Set()
const slots = new Set()
let slotDups = 0
for (const it of data.items) {
  if (!it?.id || !it?.date || !it?.title) throw new Error('条目缺 id/date/title')
  ids.add(it.id)
  const slot = `${it.date}|${it.id}`
  if (slots.has(slot)) slotDups += 1
  slots.add(slot)
}
if (slotDups) throw new Error(`同一天重复 id ${slotDups} 处（删改会对错行）`)

// public 仍须可解析（种子/构建源）
load(publicPath)

if (existsSync(dataSnap)) {
  const snap = load(dataSnap)
  const docsKeys = new Set(data.items.map(keyOf))
  const snapKeys = new Set(snap.items.map(keyOf))
  const missing = [...snapKeys].filter((k) => !docsKeys.has(k))
  const extra = [...docsKeys].filter((k) => !snapKeys.has(k))
  if (missing.length || extra.length || data.items.length !== snap.items.length) {
    console.error(
      `check-schedule: FAIL — docs (${data.items.length}) 与 h2-data snapshot (${snap.items.length}) 不一致`,
    )
    if (missing.length) console.error(`  docs 缺少 ${missing.length} 条`)
    if (extra.length) console.error(`  docs 多出 ${extra.length} 条`)
    console.error('  修复：等 h2-data reduce Action 推公开快照，或本地 node h2-data/scripts/reduce.mjs 后同步 docs')
    process.exit(1)
  }
  console.log(
    `check-schedule: ok (${data.items.length} items, docs ≡ h2-data snapshot, public seed present)`,
  )
} else {
  console.log(
    `check-schedule: ok (${data.items.length} items, format ok; no local h2-data snapshot to compare)`,
  )
}
