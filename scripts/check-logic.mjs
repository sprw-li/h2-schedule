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

console.log('check-logic: ok')
