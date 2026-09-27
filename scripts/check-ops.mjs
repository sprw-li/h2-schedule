/**
 * Unit checks: fold / diffById / no 25s polling in App.tsx
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { replaceSchedule } from '../src/lib/backup.ts'
import { diffById } from '../src/lib/ops/diff.ts'
import { fold, project } from '../src/lib/ops/fold.ts'
import { HlcClock } from '../src/lib/ops/hlc.ts'
import { coerceSchedule } from '../src/lib/schedule.ts'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const appSrc = readFileSync(join(root, 'src', 'App.tsx'), 'utf8')
assert(!/setInterval\s*\(\s*\(\s*\)\s*=>\s*\{[^}]*pullCloud/s.test(appSrc), 'App must not poll pullCloud on an interval')
assert(!/setInterval\([^)]*25000/.test(appSrc), 'App must not use 25s setInterval')
assert(/visibilitychange/.test(appSrc), 'App must listen visibilitychange')
assert(/flushOps/.test(appSrc), 'App must call flushOps')

const device = 'dev-test'
const clock = new HlcClock(device)
const meta = {
  opId: () => `op-${Math.random().toString(16).slice(2)}`,
  deviceId: device,
  nextSeq: (() => {
    let n = 1
    return () => n++
  })(),
  tickHlc: () => clock.tick(1_700_000_000_000),
}

const a = {
  id: 'id-a',
  date: '2026-09-27',
  title: 'SICA迎新',
  done: false,
  kind: 'task',
  start: '13:00',
  end: '16:00',
}
const prev = replaceSchedule([a])
const next = replaceSchedule([{ ...a, done: true }])
const ops = diffById(prev, next, meta)
assert(ops.length === 1 && ops[0].type === 'set', 'toggle done → one set op')
assert(ops[0].payload.fields.done === true, 'done must be absolute true')

const created = diffById(
  replaceSchedule([]),
  replaceSchedule([a]),
  meta,
)
assert(created[0].type === 'create', 'new id → create')

const deleted = diffById(prev, replaceSchedule([]), meta)
assert(deleted[0].type === 'delete', 'removed id → delete')

const genesis = {
  opId: 'g1',
  deviceId: 'genesis',
  clientSeq: 0,
  hlc: { wall: 1, counter: 0, device: 'genesis' },
  type: 'genesis',
  payload: { items: [a, { ...a, id: 'id-b', title: '心理咨询', start: '15:55', end: '17:00' }] },
}
const folded = fold([genesis])
assert(folded.items.length === 2, 'genesis folds to 2 items')
assert(folded.rejected.length === 0, 'no rejects')

const setDone = {
  opId: 's1',
  deviceId: device,
  clientSeq: 1,
  hlc: { wall: 2, counter: 0, device },
  type: 'set',
  payload: { id: 'id-a', fields: { done: true } },
}
const after = fold([genesis, setDone])
assert(after.items.find((i) => i.id === 'id-a')?.done === true, 'set done applies')

const del = {
  opId: 'd1',
  deviceId: device,
  clientSeq: 2,
  hlc: { wall: 3, counter: 0, device },
  type: 'delete',
  payload: { id: 'id-a' },
}
const afterDel = fold([genesis, setDone, del])
assert(!afterDel.items.find((i) => i.id === 'id-a'), 'delete removes item')
assert(afterDel.deleted['id-a'], 'deleted index by id')

const lateSet = {
  opId: 's2',
  deviceId: 'other',
  clientSeq: 1,
  hlc: { wall: 4, counter: 0, device: 'other' },
  type: 'set',
  payload: { id: 'id-a', fields: { title: '复活尝试' } },
}
const noResurrect = fold([genesis, setDone, del, lateSet])
assert(!noResurrect.items.find((i) => i.id === 'id-a'), 'set on deleted must not resurrect')
assert(noResurrect.rejected.some((r) => r.reason === 'deleted'), 'rejected deleted')

const snap = coerceSchedule(replaceSchedule([a]))
const qOps = diffById(snap, replaceSchedule([{ ...a, done: true }]), meta)
const projected = project(snap, qOps)
assert(projected['2026-09-27']?.[0]?.done === true, 'project applies queue')

console.log('check-ops: ok')
