/**
 * 结构检查：能解析、id 不撞。不再用课表业务规则（周次/抽血/考查）改数据。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const raw = readFileSync(join(root, 'docs/schedule.json'), 'utf8')
const data = JSON.parse(raw)
if (!Array.isArray(data.items)) throw new Error('schedule.json 需要 items 数组')
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
console.log(`check-schedule: ok (${data.items.length} items${dups ? `, ${dups} cross-day duplicate ids tolerated` : ''})`)
