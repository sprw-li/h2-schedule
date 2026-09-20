/**
 * 本地拉起 campus_sync_server，测 GET/PUT/409/OTA/health。
 * 不碰真实 CLab。
 */
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 18767
const TOKEN = 'campus-sync-test-token'
const BASE = `http://127.0.0.1:${PORT}`

function pyBin() {
  if (process.platform !== 'win32') return 'python3'
  return 'python'
}

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

async function main() {
  const data = await mkdtemp(join(tmpdir(), 'h2-campus-'))
  await mkdir(join(data, 'ota'), { recursive: true })
  const child = spawn(
    pyBin(),
    [join(ROOT, 'scripts', 'campus_sync_server.py'), '--host', '127.0.0.1', '--port', String(PORT), '--data-dir', data],
    { env: { ...process.env, H2_WRITE_TOKEN: TOKEN }, stdio: ['ignore', 'pipe', 'pipe'] },
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
    const payload = JSON.stringify({
      version: 1,
      items: [{ id: 'a1', date: '2026-09-20', title: '校同步探针', done: false, kind: 'task', start: '08:00', end: '09:00' }],
    })
    const put1 = await fetch(`${BASE}/schedule.json`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: payload,
    })
    if (!put1.ok) throw new Error(`PUT 失败 ${put1.status} ${out}`)
    const { sha } = await put1.json()
    const got = await fetch(`${BASE}/schedule.json`, { headers: { Authorization: `Bearer ${TOKEN}` } })
    if (!got.ok) throw new Error('GET 失败')
    const body = await got.text()
    if (!body.includes('校同步探针')) throw new Error('GET 内容不对')
    const headerSha = (got.headers.get('x-h2-sha') || '').trim()
    if (headerSha && headerSha !== sha) throw new Error('sha 不一致')

    const conflict = await fetch(`${BASE}/schedule.json`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
        'If-Match': '"deadbeef"',
      },
      body: payload,
    })
    if (conflict.status !== 409) throw new Error(`期望 409，得到 ${conflict.status}`)

    const okPut = await fetch(`${BASE}/schedule.json`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
        'If-Match': `"${sha}"`,
      },
      body: payload.replace('校同步探针', '校同步探针2'),
    })
    if (!okPut.ok) throw new Error(`If-Match PUT 失败 ${okPut.status}`)

    const man = JSON.stringify({ builtAt: '2026-09-20T00:00:00.000Z', sha256: 'abc', bytes: 4, path: 'ota/app.html' })
    const putMan = await fetch(`${BASE}/ota/manifest.json`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: man,
    })
    if (!putMan.ok) throw new Error('OTA manifest PUT 失败')
    await writeFile(join(data, 'ota', 'app.html'), '<div id="root">x</div>', 'utf8')
    const html = await fetch(`${BASE}/ota/app.html`)
    if (!html.ok) throw new Error('OTA html GET 失败')
    const home = await fetch(`${BASE}/`)
    if (!home.ok) throw new Error(`根路径期望日程页，得到 ${home.status}`)
    if (!(await home.text()).includes('id="root"')) throw new Error('根路径不是日程 HTML')

    const noAuthGet = await fetch(`${BASE}/schedule.json`)
    if (noAuthGet.status !== 401) throw new Error(`无账密 GET 期望 401，得到 ${noAuthGet.status}`)

    const noAuth = await fetch(`${BASE}/schedule.json`, { method: 'PUT', body: payload })
    if (noAuth.status !== 401) throw new Error(`无口令期望 401，得到 ${noAuth.status}`)

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
    const cur = await fetch(`${BASE}/schedule.json`, { headers: { Authorization: `Bearer ${TOKEN}` } })
    const campusSha = (cur.headers.get('x-h2-sha') || '').trim()
    const mirrored = await fetch(`${BASE}/schedule.json`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
        ...(campusSha ? { 'If-Match': `"${campusSha}"` } : {}),
      },
      body: ghPayload,
    })
    if (!mirrored.ok) throw new Error(`GitHub→CLab 镜像 PUT 失败 ${mirrored.status}`)
    const after = await fetch(`${BASE}/schedule.json`, { headers: { Authorization: `Bearer ${TOKEN}` } })
    if (!(await after.text()).includes('从GitHub镜像')) throw new Error('GitHub→CLab 镜像内容没写上')

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
