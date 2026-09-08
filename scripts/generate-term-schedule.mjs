import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const P = {
  1: ['08:00', '08:50'],
  2: ['09:00', '09:50'],
  3: ['10:10', '11:00'],
  4: ['11:10', '12:00'],
  5: ['13:00', '13:50'],
  6: ['14:00', '14:50'],
  7: ['15:10', '16:00'],
  8: ['16:10', '17:00'],
  9: ['17:10', '18:00'],
  10: ['18:40', '19:30'],
  11: ['19:40', '20:30'],
  12: ['20:40', '21:30'],
}

function key(y, m, d) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function parseKey(k) {
  const [y, m, d] = k.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function toKey(dt) {
  return key(dt.getFullYear(), dt.getMonth() + 1, dt.getDate())
}

function weekOf(dt) {
  const start = new Date(2026, 8, 7)
  const days = Math.round((dt - start) / 86400000)
  return Math.floor(days / 7) + 1
}

function isHoliday(k) {
  if (k === '2026-09-25') return true
  return k >= '2026-10-01' && k <= '2026-10-07'
}

function inClassTerm(k) {
  return k >= '2026-09-07' && k <= '2026-12-27'
}

function titled(name, room) {
  return room ? `${name} · ${room}` : name
}

function item(date, title, start, end, kind = 'task', allDay = false) {
  const row = { id: randomUUID(), date, title, done: false, kind }
  if (allDay) row.allDay = true
  if (!allDay && start) row.start = start
  if (!allDay && end) row.end = end
  return row
}

function span(a, b) {
  return [P[a][0], P[b][1]]
}

const items = []

for (let dt = new Date(2026, 8, 7); dt <= new Date(2026, 11, 27); dt.setDate(dt.getDate() + 1)) {
  const k = toKey(dt)
  if (isHoliday(k) || !inClassTerm(k)) continue
  const w = dt.getDay()
  const week = weekOf(dt)

  if (w === 1) {
    items.push(item(k, titled('普通化学', '理教201'), ...span(3, 4)))
    items.push(item(k, titled('普通化学习题课', '理教201'), ...span(7, 8)))
  }
  if (w === 2) {
    items.push(item(k, titled('高等数学(B)(一)', '理教202'), ...span(1, 2)))
    items.push(item(k, titled('英汉口译', '文史309'), ...span(5, 6)))
    items.push(item(k, titled('计算概论(B)', '理教207'), ...span(7, 9)))
    if (k !== '2026-09-08') {
      items.push(item(k, titled('数学习题课', '二教315/311/302'), ...span(10, 11)))
    }
  }
  if (w === 3) {
    items.push(item(k, titled('普通化学', '理教201'), ...span(1, 2)))
    items.push(item(k, titled('化学实验室安全技术', '二教207'), ...span(3, 4)))
    items.push(item(k, titled('理论与计算化学导论', '理教410'), ...span(5, 6)))
    if (k === '2026-09-09') {
      items.push(
        item(k, titled('今日化学导论', '化学学院小伦报告厅101'), '15:10', undefined),
      )
    } else {
      items.push(item(k, titled('今日化学'), ...span(7, 8)))
    }
    if (week % 2 === 1) {
      items.push(item(k, titled('博雅理学讲堂', '哲学201'), ...span(10, 11)))
    }
  }
  if (w === 4) {
    if (k === '2026-09-10') {
      items.push(
        item(k, titled('普通化学实验导论', '化学学院小伦报告厅101'), '08:00', undefined),
      )
    } else {
      items.push(item(k, titled('普通化学实验'), ...span(1, 4)))
    }
    if (week === 16) {
      items.push(
        item(k, titled('计算概论(B)上机 机考', '计算中心三层1/4/5室'), ...span(7, 8), 'deadline'),
      )
    } else {
      items.push(item(k, titled('计算概论(B)上机', '计算中心三层1/4/5室'), ...span(7, 8)))
    }
    items.push(item(k, '组会', '18:30', '21:30'))
  }
  if (w === 5) {
    items.push(item(k, titled('高等数学(B)(一)', '理教202'), ...span(3, 4)))
    items.push(item(k, titled('大学生思想文化素养', '理教313'), ...span(10, 11)))
  }
}

for (const k of ['2026-09-07', '2026-09-08', '2026-09-09']) {
  items.push(item(k, '内务检查'))
}
items.push(item('2026-09-08', 'C317 签字；A203 盖章交表', '10:00', undefined))
items.push(item('2026-09-09', '新太阳 105–106 室图像采集'))
items.push(item('2026-09-11', '医院 MRI / 开证明并申请保健课', '13:00', undefined))
items.push(item('2026-09-18', '学院科协预实验（占用上课时间）', ...span(1, 3)))
items.push(item('2026-12-09', '合唱'))
items.push(item('2026-09-16', '论文选题与小组成员提交', undefined, undefined, 'deadline'))
items.push(item('2026-11-13', '论文提交', undefined, '23:59', 'deadline'))
items.push(item('2026-10-21', '可能测验一', undefined, undefined, 'deadline', true))
items.push(item('2026-12-09', '可能测验二', undefined, undefined, 'deadline', true))

function addRange(from, to, title) {
  for (let dt = parseKey(from); dt <= parseKey(to); dt.setDate(dt.getDate() + 1)) {
    items.push(item(toKey(dt), title, undefined, undefined, 'holiday'))
  }
}

for (const k of ['2026-10-12', '2026-10-26', '2026-11-09', '2026-11-23']) {
  items.push(item(k, '军事理论直播课', '18:30', '20:30'))
}

addRange('2026-09-20', '2026-09-20', '公休')
addRange('2026-09-25', '2026-09-25', '中秋放假')
addRange('2026-09-26', '2026-09-27', '公休')
addRange('2026-10-01', '2026-10-07', '国庆放假')
addRange('2026-10-10', '2026-10-10', '公休')
addRange('2027-01-11', '2027-02-21', '寒假')

items.push(item('2026-12-28', '高等数学(B)(一) 考试', undefined, '21:30', 'deadline'))
items.push(item('2026-12-28', '军事理论 考查', undefined, undefined, 'deadline'))
items.push(item('2026-12-28', '英汉口译 考查', undefined, undefined, 'deadline'))
items.push(item('2026-12-28', '化学实验室安全技术 考查', undefined, undefined, 'deadline'))
items.push(item('2026-12-28', '今日化学 考查', undefined, undefined, 'deadline'))
items.push(item('2026-12-28', '博雅理学讲堂 考查', undefined, undefined, 'deadline'))
items.push(item('2026-12-28', '普通化学实验 考查', undefined, undefined, 'deadline'))
items.push(item('2026-12-30', '理论与计算化学导论 考试', undefined, '18:00', 'deadline'))
items.push(item('2026-12-31', '大学生思想文化素养 考试', undefined, '21:30', 'deadline'))
items.push(item('2027-01-05', '计算概论(B) 考试', undefined, '18:00', 'deadline'))
items.push(item('2027-01-05', '普通化学习题课 考试', undefined, '18:00', 'deadline'))
items.push(item('2027-01-06', '普通化学 考试', undefined, '12:00', 'deadline'))

items.sort((a, b) => {
  if (a.date !== b.date) return a.date.localeCompare(b.date)
  const ta = a.start ?? a.end ?? '99:99'
  const tb = b.start ?? b.end ?? '99:99'
  if (ta !== tb) return ta.localeCompare(tb)
  return a.title.localeCompare(b.title, 'zh')
})

const out = JSON.stringify({ items }, null, 2) + '\n'
writeFileSync(join(root, 'public', 'schedule.json'), out)
console.log(`wrote ${items.length} items`)
