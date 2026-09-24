/**
 * 回归：同课两节次、本机删除、CSV 导入不得互相覆盖。
 * 用 node --experimental-strip-types 直接加载 src。
 */
import { flattenItems } from '../src/lib/backup.ts'
import { mergeCsvIntoSchedule, scheduleToCsv } from '../src/lib/csv.ts'
import { mergeByIdentity, normalizeSchedule } from '../src/lib/sync.ts'

function item(partial) {
  return {
    done: false,
    kind: 'task',
    ...partial,
  }
}

function titlesOn(map, date) {
  return flattenItems(map)
    .filter((i) => i.date === date)
    .map((i) => `${i.title}@${i.start ?? ''}-${i.end ?? ''}`)
    .sort()
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

const date = '2026-09-16'
const a = item({
  id: 'same-id',
  date,
  title: '1220理论与计算化学上机',
  start: '12:10',
  end: '13:00',
})
const b = item({
  id: 'same-id',
  date,
  title: '化学实验室安全技术 · 二教207',
  start: '10:10',
  end: '12:00',
})
const c = item({
  id: 'chem-a',
  date,
  title: '普通化学',
  start: '08:00',
  end: '08:50',
})
const d = item({
  id: 'chem-b',
  date,
  title: '普通化学',
  start: '09:00',
  end: '09:50',
})

const unique = normalizeSchedule([a, b])
assert(flattenItems(unique).length === 2, '同日撞 id 应拆成两条')
assert(new Set(flattenItems(unique).map((i) => `${i.date}|${i.id}`)).size === 2, '拆开后 date+id 必须唯一')

const twoPeriods = normalizeSchedule([c, d])
assert(titlesOn(twoPeriods, date).length === 2, '同课不同节次都要留')

const mergedKeep = mergeByIdentity(twoPeriods, twoPeriods, false, null)
assert(titlesOn(mergedKeep, date).length === 2, '合并不得压掉第二节')

const localDeleted = normalizeSchedule([c])
const afterDelete = mergeByIdentity(twoPeriods, localDeleted, true, twoPeriods)
assert(
  titlesOn(afterDelete, date).join() === titlesOn(localDeleted, date).join(),
  '本机删掉的节次不得被云端 baseline 拉回来',
)

const withoutBaseline = mergeByIdentity(twoPeriods, localDeleted, true, null)
assert(titlesOn(withoutBaseline, date).length === 2, '无 baseline 时远端多的节次仍应并入')

const remoteDropped = normalizeSchedule([c])
const droppedOnCloud = mergeByIdentity(remoteDropped, twoPeriods, false, twoPeriods)
assert(
  titlesOn(droppedOnCloud, date).join() === titlesOn(remoteDropped, date).join(),
  '云端删掉的节次不得被本机旧副本加回',
)

const csv = scheduleToCsv(twoPeriods)
const fromCsv = mergeCsvIntoSchedule({}, csv)
assert(titlesOn(fromCsv, date).length === 2, 'CSV 往空表导入应保留两节')

const csvClobber = mergeCsvIntoSchedule(twoPeriods, scheduleToCsv(normalizeSchedule([c])))
assert(titlesOn(csvClobber, date).length === 2, '只含一节的 CSV 不得删掉本机另一节')

const renamed = normalizeSchedule([{ ...c, title: '血检—康复' }])
const remoteWinsOld = mergeByIdentity(twoPeriods, renamed, false, null)
assert(
  flattenItems(remoteWinsOld).some((i) => i.id === 'chem-a' && i.title === '血检—康复'),
  '同 id 本机改标题不得被远端旧标题盖掉',
)

const localOpen = normalizeSchedule([{ ...c, done: false }])
const remoteDone = normalizeSchedule([{ ...c, done: true }])
const keepOpen = mergeByIdentity(remoteDone, localOpen, false, null)
assert(flattenItems(keepOpen)[0].done === false, '本机未完成不得被远端 done 或回去')

const laterDay = mergeByIdentity(
  normalizeSchedule([{ ...c, date: '2026-09-22' }]),
  renamed,
  false,
  null,
)
assert(
  !flattenItems(laterDay).some((i) => i.date === '2026-09-22' && i.title === '血检—康复'),
  '改 16 号标题不得挂到 22 号',
)

const skeleton = item({
  id: 'theo-short',
  date,
  title: '理论与计算化学导论 · 理教410',
  start: '13:00',
  end: '14:50',
})
const detailed = item({
  id: 'theo-long',
  date,
  title: '理论与计算化学导论（杨立江） · 理教410',
  start: '13:00',
  end: '14:50',
})
const jinShort = item({
  id: 'jin-short',
  date,
  title: '今日化学',
  start: '15:10',
  end: '17:00',
})
const jinLong = item({
  id: 'jin-long',
  date,
  title: '今日化学 · 高分子化学（刘允） · 化学楼B400',
  start: '15:10',
  end: '17:00',
})
// 同段不同事项是正常的：normalize 不得按标题前缀静默删（collapseCoveredDuplicates 已移出同步路径）
const kept = normalizeSchedule([skeleton, detailed, jinShort, jinLong])
assert(flattenItems(kept).length === 4, '同段「标题前缀关系」的不同事项不得被静默删除')
assert(
  flattenItems(kept).some((i) => i.title.includes('杨立江')) &&
    flattenItems(kept).some((i) => i.title === '理论与计算化学导论 · 理教410'),
  '骨架条与详条都必须保留',
)

const origItem = item({
  id: 'orig-id',
  date,
  title: '被删的课',
  start: '10:10',
  end: '12:00',
})
const baselineOrig = normalizeSchedule([origItem])
const localDupId = normalizeSchedule([{ ...origItem, id: 'dup-deadbeef' }])
assert(flattenItems(localDupId)[0].id.startsWith('dup-'), '本机 id 应为 dup- 后缀')
const droppedByRow = mergeByIdentity(normalizeSchedule([]), localDupId, false, baselineOrig)
assert(flattenItems(droppedByRow).length === 0, 'id 改成 dup- 后云端删除仍应按 rowKey 丢掉')

const remoteStillOrig = normalizeSchedule([origItem])
const localDeletedRow = mergeByIdentity(remoteStillOrig, normalizeSchedule([]), true, localDupId)
assert(flattenItems(localDeletedRow).length === 0, '本机删除应按 rowKey 对称丢掉远端同内容条目')

const book = item({
  id: 'book',
  date,
  title: '拿书',
  start: '09:00',
  end: '10:00',
})
const blood = item({
  id: 'blood',
  date,
  title: '血检',
  start: '09:00',
  end: '10:00',
})
const lab = item({
  id: 'lab',
  date: '2026-09-21',
  title: '上机',
  start: '13:00',
  end: '14:50',
})
const exercise = item({
  id: 'ex',
  date: '2026-09-21',
  title: '习题课',
  start: '13:00',
  end: '14:50',
})
const sameSlotDiff = normalizeSchedule([book, blood, lab, exercise])
assert(flattenItems(sameSlotDiff).length === 4, '同日同时刻标题不同的事项不得被 collapse 吃掉')
const mergedSameSlot = mergeByIdentity(sameSlotDiff, sameSlotDiff, false, null)
assert(flattenItems(mergedSameSlot).length === 4, 'merge 后同日同时刻不同事项仍是四条')
assert(
  titlesOn(sameSlotDiff, date).join() === '拿书@09:00-10:00,血检@09:00-10:00',
  '9/16 拿书+血检都应保留',
)
assert(
  titlesOn(sameSlotDiff, '2026-09-21').join() === '上机@13:00-14:50,习题课@13:00-14:50',
  '9/21 上机+习题课都应保留',
)

const localOnlyC = normalizeSchedule([c])
const csvSkipDeleted = mergeCsvIntoSchedule(localOnlyC, scheduleToCsv(twoPeriods), twoPeriods)
assert(
  titlesOn(csvSkipDeleted, date).join() === titlesOn(localOnlyC, date).join(),
  'CSV 不得把用户已删的课当新行加回',
)

const brandNew = item({
  id: 'hw-new',
  date,
  title: '全新作业',
  start: '18:00',
  end: '19:00',
})
const csvAddNew = mergeCsvIntoSchedule(
  localOnlyC,
  scheduleToCsv(normalizeSchedule([c, d, brandNew])),
  twoPeriods,
)
assert(
  flattenItems(csvAddNew).some((i) => i.title === '全新作业'),
  'snap 与本机都没有的新作业仍可加入',
)
assert(
  !flattenItems(csvAddNew).some((i) => i.id === 'chem-b' || (i.title === '普通化学' && i.start === '09:00')),
  '已删的第二节不得随新作业 CSV 一起回来',
)

console.log('check-logic: ok')
