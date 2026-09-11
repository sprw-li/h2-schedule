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

const ROOM_LECTURE = '理教410'
const ROOM_LAB = '计算中心二层3号机房'

/**
 * 理论与计算化学导论 · 周三 5–6 节
 * 表：课堂讲授理教410 / 上机计算中心二层3号机房（按次写死，不再用「前8后7」）
 */
const THEO_SESSIONS = [
  ['2026-09-09', '杨立江', 'lecture', '肖云龙做20分钟总体介绍'],
  ['2026-09-16', '杨立江', 'lecture', ''],
  ['2026-09-23', '杨立江', 'lab', ''],
  ['2026-09-30', '李霄', 'lecture', ''],
  // 10/7 国庆放假
  ['2026-10-14', '李霄', 'lab', ''],
  ['2026-10-21', '李霄', 'lab', ''],
  ['2026-10-28', '杨立江', 'lab', ''],
  ['2026-11-04', '肖云龙', 'lecture', ''],
  ['2026-11-11', '肖云龙', 'lecture', ''],
  ['2026-11-18', '肖云龙', 'lecture', ''],
  ['2026-11-25', '肖云龙', 'lab', ''],
  ['2026-12-02', '李晨', 'lecture', ''],
  ['2026-12-09', '李晨', 'lecture', ''],
  ['2026-12-16', '李晨', 'lab', ''],
  ['2026-12-23', '李晨', 'lab', ''],
]

/** 普通化学实验 · 周四；国庆两周停做 */
const CHEM_LAB = [
  ['2026-09-10', '绪论课、清点和认识仪器', '化学院肖伦报告厅101', '08:00', '09:50'],
  ['2026-09-17', '仪器的洗涤和干燥；铜的反应循环', '化学院', ...span(1, 4)],
  ['2026-09-24', '沉淀生成与分步沉淀；量子点制备', '化学院', ...span(1, 4)],
  // 10/01、10/08 国庆假期
  ['2026-10-15', '元素性质与化学平衡', '化学院', ...span(1, 4)],
  ['2026-10-22', '混合阴离子溶液的分离及检出', '化学院', ...span(1, 4)],
  ['2026-10-29', '阴离子未知液的分析（考查实验）', '化学院', ...span(1, 4)],
  ['2026-11-05', '提纯氯化钠', '化学院', ...span(1, 4)],
  ['2026-11-12', '未知弱酸/碱电离常数的测定', '化学院', ...span(1, 4)],
  ['2026-11-19', '解法测定阿伏加德罗常数及气体常数', '化学院', ...span(1, 4)],
  ['2026-11-26', '化学反应速率与活化能的测定', '化学院', ...span(1, 4)],
  ['2026-12-03', '溶剂变色Ni(II)配合物的固相合成；硫酸亚铁铵的制备', '化学院', ...span(1, 4)],
  ['2026-12-10', '简易光度计的搭建；自制硫酸亚铁铵中Fe(III)的测定', '化学院', ...span(1, 4)],
  ['2026-12-17', '浊点萃取法测定啤酒中铁含量', '化学院', ...span(1, 4)],
  ['2026-12-24', '草酸亚铁的制备及化学式的测定', '化学院', ...span(1, 4)],
]

// 今日化学 · 8 班专题（周三 7~8 节 15:10–17:00）
const CHEM_TODAY_8 = [
  ['2026-09-09', '今日化学 绪论', '化学楼肖伦报告厅101'],
  ['2026-09-16', '今日化学 · 高分子化学（刘允）', '化学楼B400'],
  ['2026-09-23', '今日化学 · 化学生物学（季者）', '化学楼CB106'],
  ['2026-09-30', '今日化学 · 理论与计算化学（刘剑）', '化学楼CB121'],
  ['2026-10-14', '今日化学 · 无机化学（卞祖强）', '化学楼A813'],
  ['2026-10-21', '今日化学 · 物理化学（马丁）', '化学楼B300'],
  ['2026-10-28', '今日化学 · 应用化学（刘志博）', '技物楼211'],
  ['2026-11-04', '今日化学 · 有机化学（焦阳）', '化学楼CB213'],
  ['2026-11-11', '今日化学 · 分析化学（夏斌）', '核磁中心106'],
]

const THEO_BY_DATE = new Map(THEO_SESSIONS.map((row) => [row[0], row]))

const items = []

// 按选课结果（已选上）展开；周次/节次/教室以选课表为准
for (let dt = new Date(2026, 8, 7); dt <= new Date(2026, 11, 27); dt.setDate(dt.getDate() + 1)) {
  const k = toKey(dt)
  if (isHoliday(k) || !inClassTerm(k)) continue
  const w = dt.getDay()
  const week = weekOf(dt)

  if (w === 1) {
    // 普通化学 周一 3~4 · 理教201
    items.push(item(k, titled('普通化学', '理教201'), ...span(3, 4)))
    // 普通化学习题课 周一 7~8 · 理教201
    items.push(item(k, titled('普通化学习题课', '理教201'), ...span(7, 8)))
  }

  if (w === 2) {
    // 高等数学(B)(一) 周二 1~2 · 理教202
    items.push(item(k, titled('高等数学(B)(一)', '理教202'), ...span(1, 2)))
    // 英汉口译 周二 5~6 · 文史309
    items.push(item(k, titled('英汉口译', '文史309'), ...span(5, 6)))
    // 计算概论(B) 周二 7~9 · 理教207
    items.push(item(k, titled('计算概论(B)', '理教207'), ...span(7, 9)))
    // 高数习题 周二 10~11 · 二教315/311/302
    items.push(item(k, titled('数学习题课', '二教315/311/302'), ...span(10, 11)))
  }

  if (w === 3) {
    // 普通化学 周三 1~2 · 理教201
    items.push(item(k, titled('普通化学', '理教201'), ...span(1, 2)))
    // 化学实验室安全技术 周三 3~4 · 二教207 · 第 6~14 周
    if (week >= 6 && week <= 14) {
      items.push(item(k, titled('化学实验室安全技术', '二教207'), ...span(3, 4)))
    }
    // 理论与计算化学导论：按授课表逐次写死教室/老师（不再用前8后7）
    const theo = THEO_BY_DATE.get(k)
    if (theo) {
      const [, teacher, mode, note] = theo
      const room = mode === 'lab' ? ROOM_LAB : ROOM_LECTURE
      let title = titled(`理论与计算化学导论（${teacher}）`, room)
      if (note) title = `${title} · ${note}`
      items.push(item(k, title, ...span(5, 6)))
    }
    // 博雅理学讲堂 单周周三 10~11 · 哲学201
    if (week % 2 === 1) {
      items.push(item(k, titled('博雅理学讲堂', '哲学201'), ...span(10, 11)))
    }
  }

  if (w === 4) {
    // 普通化学实验见下方 CHEM_LAB 表；此处只排上机与组会
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
    // 高等数学(B)(一) 周五 3~4 · 理教202
    items.push(item(k, titled('高等数学(B)(一)', '理教202'), ...span(3, 4)))
    // 大学生思想文化素养 周五 10~11 · 理教313
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

for (const [date, title, room] of CHEM_TODAY_8) {
  items.push(item(date, titled(title, room), ...span(7, 8)))
}
items.push(
  item('2026-11-18', titled('今日化学 happyhour（无需全程参加）', '化学院'), '14:00', '18:00'),
)

for (const [date, name, room, start, end] of CHEM_LAB) {
  items.push(item(date, titled(`普通化学实验 · ${name}`, room), start, end))
}

function addRange(from, to, title) {
  for (let dt = parseKey(from); dt <= parseKey(to); dt.setDate(dt.getDate() + 1)) {
    items.push(item(toKey(dt), title, undefined, undefined, 'holiday'))
  }
}

for (const k of ['2026-10-12', '2026-10-26', '2026-11-09', '2026-11-23']) {
  items.push(item(k, '军事理论直播课', '18:30', '20:30'))
}

addRange('2026-09-25', '2026-09-25', '中秋放假')
addRange('2026-09-26', '2026-09-27', '公休')
addRange('2026-10-01', '2026-10-07', '国庆放假')
addRange('2026-10-10', '2026-10-10', '公休')
addRange('2027-01-11', '2027-02-21', '寒假')

items.push(item('2026-12-28', '停课复习考试（至 1 月 10 日）', undefined, undefined, 'deadline', true))
items.push(item('2026-12-28', '高等数学(B)(一) 考试', undefined, '21:30', 'deadline'))
items.push(item('2026-12-30', '理论与计算化学导论 考试', undefined, '18:00', 'deadline'))
items.push(item('2026-12-31', '大学生思想文化素养 考试', undefined, '21:30', 'deadline'))
items.push(item('2027-01-05', '计算概论(B) 考试', undefined, '18:00', 'deadline'))
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
