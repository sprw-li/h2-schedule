/**
 * 本地拉起 campus_sync_server，测 GET/PUT/If-Match/并发/备份/OTA/health。
 * 不碰真实 CLab。
 *
 * 乐观锁回归（P0 止血）：
 * - 无 If-Match 的 PUT 必须被拒（428），且不得创建/改动文件（盲写不污染）
 * - 错误 If-Match 必须 409，内容不变
 * - 正确 If-Match 必须成功
 * - 并发两个 PUT（同一旧 sha）只有一个成功
 * - 每次成功覆盖前生成备份，且数量上限生效
 */
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile, mkdir, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 18767
const TOKEN = 'campus-sync-test-token'
const BASE = `http://127.0.0.1:${PORT}`
const BACKUP_KEEP = 3

function pyBin() {
  if (process.platform !== 'win32') return 'python3'
  return 'python'
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

function schedulePayload(title) {
  return JSON.stringify({
    version: 1,
    items: [{ id: 'a1', date: '2026-09-20', title, done: false, kind: 'task', start: '08:00', end: '09:00' }],
  })
}

const authHeaders = { Authorization: `Bearer ${TOKEN}` }

async function waitHealth() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`${BASE}/health`)
      if (res.ok) {
        const j = await res.json()
        if (j.ok && j.role === 'sot') return
      }
    } catch {
      /* starting */
    }
    await new Promise((r) => setTimeout(r, 150))
  }
  throw new Error('校同步服务未起来')
}

function putSchedule(body, ifMatch) {
  const headers = { ...authHeaders, 'Content-Type': 'application/json' }
  if (ifMatch !== undefined) headers['If-Match'] = ifMatch
  return fetch(`${BASE}/schedule.json`, { method: 'PUT', headers, body })
}

async function currentSha() {
  const res = await fetch(`${BASE}/schedule.json`, { headers: authHeaders })
  assert(res.ok, `GET 失败 ${res.status}`)
  return { sha: (res.headers.get('x-h2-sha') || '').trim(), text: await res.text() }
}

async function main() {
  const data = await mkdtemp(join(tmpdir(), 'h2-campus-'))
  await mkdir(join(data, 'ota'), { recursive: true })
  const child = spawn(
    pyBin(),
    [join(ROOT, 'scripts', 'campus_sync_server.py'), '--host', '127.0.0.1', '--port', String(PORT), '--data-dir', data],
    {
      env: { ...process.env, H2_WRITE_TOKEN: TOKEN, H2_BACKUP_KEEP: String(BACKUP_KEEP) },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  let out = ''
  child.stdout.on('data', (c) => {
    out += c.toString()
  })
  child.stderr.on('data', (c) => {
    out += c.toString()
  })
  try {
    await waitHealth()

    // 1) 不带 If-Match：必须被拒（428），且不得创建文件（盲写不污染）
    const blind = await putSchedule(schedulePayload('盲写探针'), undefined)
    assert(blind.status === 428, `无 If-Match 期望 428，得到 ${blind.status} ${out}`)
    const afterBlind = await fetch(`${BASE}/schedule.json`, { headers: authHeaders })
    assert(afterBlind.status === 404, `盲写不得创建文件，期望 404，得到 ${afterBlind.status}`)

    // 2) 错误 If-Match（文件还不存在，sha 为空）：必须 409
    const wrongOnEmpty = await putSchedule(schedulePayload('错误sha'), '"deadbeef"')
    assert(wrongOnEmpty.status === 409, `错误 If-Match 期望 409，得到 ${wrongOnEmpty.status}`)

    // 3) 首次创建用 If-Match: *：必须成功
    const create = await putSchedule(schedulePayload('校同步探针'), '*')
    assert(create.ok, `If-Match:* 创建失败 ${create.status} ${out}`)
    const { sha: sha1 } = await create.json()
    assert(!!sha1, '创建响应缺 sha')

    // 4) GET 内容与 header sha
    const got = await currentSha()
    assert(got.text.includes('校同步探针'), 'GET 内容不对')
    assert(got.sha === sha1, `header sha 与返回 sha 不一致：${got.sha} vs ${sha1}`)

    // 5) 错误 If-Match（已有文件）：必须 409，且内容不变
    const wrong2 = await putSchedule(schedulePayload('不该写上'), '"deadbeef"')
    assert(wrong2.status === 409, `错误 If-Match 期望 409，得到 ${wrong2.status}`)
    const unchanged = await currentSha()
    assert(unchanged.text.includes('校同步探针'), '409 后内容被改了')

    // 6) 正确 If-Match：必须成功
    const okPut = await putSchedule(schedulePayload('校同步探针2'), `"${sha1}"`)
    assert(okPut.ok, `正确 If-Match PUT 失败 ${okPut.status}`)
    const { sha: sha2 } = await okPut.json()
    assert(sha2 && sha2 !== sha1, '覆盖后 sha 应变化')

    // 7) 并发两个 PUT，都带旧 sha2：只有一个能成功
    const [c1, c2] = await Promise.all([
      putSchedule(schedulePayload('并发A'), `"${sha2}"`),
      putSchedule(schedulePayload('并发B'), `"${sha2}"`),
    ])
    const codes = [c1.status, c2.status].sort((a, b) => a - b)
    assert(
      codes[0] === 200 && codes[1] === 409,
      `并发期望恰好一个 200 一个 409，得到 ${codes.join(',')}`,
    )

    // 8) 备份：每次成功覆盖前生成，数量上限生效
    const backupsDir = join(data, 'backups')
    let backups = await readdir(backupsDir).catch(() => [])
    assert(backups.length > 0, '成功覆盖后应生成备份文件')

    // 再连续覆盖若干次，冲过上限
    for (let i = 0; i < BACKUP_KEEP + 3; i++) {
      const { sha } = await currentSha()
      const res = await putSchedule(schedulePayload(`覆盖${i}`), `"${sha}"`)
      assert(res.ok, `顺序覆盖 ${i} 失败 ${res.status}`)
    }
    backups = await readdir(backupsDir).catch(() => [])
    assert(
      backups.length <= BACKUP_KEEP,
      `备份数量应受上限 ${BACKUP_KEEP} 约束，实际 ${backups.length}`,
    )
    assert(backups.length === BACKUP_KEEP, `备份应恰好保留 ${BACKUP_KEEP} 个，实际 ${backups.length}`)
    assert(backups.every((n) => n.endsWith('.bak')), '备份文件名应以 .bak 结尾')

    // 9) OTA manifest / html / 根路径
    const man = JSON.stringify({ builtAt: '2026-09-20T00:00:00.000Z', sha256: 'abc', bytes: 4, path: 'ota/app.html' })
    const putMan = await fetch(`${BASE}/ota/manifest.json`, {
      method: 'PUT',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: man,
    })
    assert(putMan.ok, 'OTA manifest PUT 失败')
    await writeFile(join(data, 'ota', 'app.html'), '<div id="root">x</div>', 'utf8')
    const html = await fetch(`${BASE}/ota/app.html`)
    assert(html.ok, 'OTA html GET 失败')
    const home = await fetch(`${BASE}/`)
    assert(home.ok, `根路径期望日程页，得到 ${home.status}`)
    assert((await home.text()).includes('id="root"'), '根路径不是日程 HTML')

    // 10) 鉴权
    const noAuthGet = await fetch(`${BASE}/schedule.json`)
    assert(noAuthGet.status === 401, `无账密 GET 期望 401，得到 ${noAuthGet.status}`)
    const noAuth = await fetch(`${BASE}/schedule.json`, { method: 'PUT', body: schedulePayload('x') })
    assert(noAuth.status === 401, `无口令期望 401，得到 ${noAuth.status}`)

    // 11) GitHub→CLab 镜像（带正确 If-Match）
    const ghPayload = JSON.stringify({
      version: 1,
      items: [
        {
          id: 'gh1',
          date: '2026-09-21',
          title: '从GitHub镜像',
          done: false,
          kind: 'task',
          start: '14:00',
          end: '15:00',
        },
      ],
    })
    const cur = await currentSha()
    const mirrored = await putSchedule(ghPayload, `"${cur.sha}"`)
    assert(mirrored.ok, `GitHub→CLab 镜像 PUT 失败 ${mirrored.status}`)
    const after = await currentSha()
    assert(after.text.includes('从GitHub镜像'), 'GitHub→CLab 镜像内容没写上')

    console.log('campus sync ok')
  } finally {
    child.kill()
    await rm(data, { recursive: true, force: true })
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
