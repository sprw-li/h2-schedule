#!/usr/bin/env node
/**
 * 把本机 docs/ota/{manifest.json,app.html} PUT 到 CLab 校服务器。
 *
 * 断口背景：校服务器支持 PUT /ota/manifest.json 与 /ota/app.html，但以前没有任何脚本调用，
 * 于是选了 CLab 源的手机永远拿到 CLab 上的旧 OTA 包（布局修复到不了手机）。
 * 改完界面后：npm run build:phone && npm run push:ota:campus
 *
 * 根地址只读 .env.phone 里的 VITE_CAMPUS_ORIGIN（非秘密）。
 * 账密只从环境变量取：VITE_CAMPUS_USER / VITE_CAMPUS_PASS，或 H2_USER / H2_PASS。
 * 绝不硬编码、绝不打印。
 *
 * 用法：
 *   npm run push:ota:campus            上传并回读校验
 *   npm run push:ota:campus -- --dry-run   只做本地自检，不联网
 *   npm run push:ota:campus -- --no-auth   服务器未配口令时才用（不带 Authorization）
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifestFile = join(root, 'docs', 'ota', 'manifest.json')
const htmlFile = join(root, 'docs', 'ota', 'app.html')
const TIMEOUT_MS = 15000

const argv = process.argv.slice(2)
const dryRun = argv.includes('--dry-run')
const noAuth = argv.includes('--no-auth')

function fail(msg) {
  console.error(`push:ota:campus: FAIL — ${msg}`)
  process.exit(1)
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

function originFromEnvFile() {
  const fromProcess = (process.env.VITE_CAMPUS_ORIGIN ?? '').trim()
  if (fromProcess) return fromProcess
  if (!existsSync(join(root, '.env.phone'))) return ''
  for (const line of readFileSync(join(root, '.env.phone'), 'utf8').split(/\r?\n/)) {
    const m = /^\s*VITE_CAMPUS_ORIGIN\s*=\s*(.*?)\s*$/.exec(line)
    if (m) return m[1].replace(/^["']|["']$/g, '').trim()
  }
  return ''
}

function credentials() {
  const user = (process.env.VITE_CAMPUS_USER ?? process.env.H2_USER ?? '').trim()
  const pass = (process.env.VITE_CAMPUS_PASS ?? process.env.H2_PASS ?? '').trim()
  return { user, pass }
}

async function request(url, init = {}) {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch {
    fail('CLab 不可达（需在校内网）')
  }
}

async function main() {
  const origin = originFromEnvFile().replace(/\/$/, '')
  if (!origin) {
    fail('未配置校服务器根地址：请在 .env.phone 写 VITE_CAMPUS_ORIGIN=<http://10.x.x.x:port>')
  }

  if (!existsSync(manifestFile) || !existsSync(htmlFile)) {
    fail('缺少 docs/ota/manifest.json 或 docs/ota/app.html，先跑 npm run build:phone')
  }
  const manifestBuf = readFileSync(manifestFile)
  const htmlBuf = readFileSync(htmlFile)
  let manifest
  try {
    manifest = JSON.parse(manifestBuf.toString('utf8'))
  } catch {
    fail('docs/ota/manifest.json 不是合法 JSON')
  }
  if (!manifest?.sha256 || !manifest?.path) fail('docs/ota/manifest.json 缺 sha256 / path')

  // 本地自检：manifest 声明的 sha256 必须就是本机 app.html 的 sha256，否则推上去也是坏包
  const localSha = sha256(htmlBuf)
  if (localSha !== manifest.sha256) {
    fail(`本机包自检不过：app.html sha256=${localSha.slice(0, 12)}… 与 manifest=${String(manifest.sha256).slice(0, 12)}… 不一致`)
  }

  console.log(`本机包 OK  builtAt=${manifest.builtAt} bytes=${htmlBuf.length} sha256=${localSha.slice(0, 12)}…`)
  console.log(`目标 CLab  ${origin}`)

  if (dryRun) {
    console.log('dry-run：本地自检通过，未联网。将 PUT /ota/manifest.json 与 /ota/app.html 并回读校验。')
    return
  }

  let authHeader = ''
  if (!noAuth) {
    const { user, pass } = credentials()
    if (!user || !pass) {
      fail(
        '未提供校服务器凭据：请设 VITE_CAMPUS_USER / VITE_CAMPUS_PASS（或 H2_USER / H2_PASS）环境变量；' +
          '服务器确实未配口令时才加 --no-auth',
      )
    }
    authHeader = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`
  }
  const headers = authHeader ? { Authorization: authHeader } : {}

  const targets = [
    { url: `${origin}/ota/manifest.json`, body: manifestBuf, ctype: 'application/json; charset=utf-8' },
    { url: `${origin}/ota/app.html`, body: htmlBuf, ctype: 'text/html; charset=utf-8' },
  ]
  for (const t of targets) {
    const res = await request(t.url, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': t.ctype },
      body: t.body,
    })
    if (res.status === 401 || res.status === 403) fail(`CLab 拒绝上传（${res.status}）：账密不对或权限不足`)
    if (!res.ok) fail(`PUT ${t.url} 失败：HTTP ${res.status}`)
  }

  // 回读校验：manifest 逐字节相同；app.html 的 sha256 等于 manifest.sha256
  const manRes = await request(`${origin}/ota/manifest.json`)
  if (!manRes.ok) fail(`回读 manifest 失败：HTTP ${manRes.status}`)
  const manBack = Buffer.from(await manRes.arrayBuffer())
  if (!manBack.equals(manifestBuf)) fail('回读 manifest 与本地不一致（逐字节比对失败）')

  const htmlRes = await request(`${origin}/ota/app.html`)
  if (!htmlRes.ok) fail(`回读 app.html 失败：HTTP ${htmlRes.status}`)
  const htmlBack = Buffer.from(await htmlRes.arrayBuffer())
  const backSha = sha256(htmlBack)
  if (backSha !== manifest.sha256) {
    fail(`回读 app.html 校验不过：sha256=${backSha.slice(0, 12)}… ≠ manifest=${String(manifest.sha256).slice(0, 12)}…`)
  }

  console.log(`push:ota:campus: ok  manifest 逐字节一致，app.html sha256=${backSha.slice(0, 12)}… 一致（${htmlBack.length} bytes）`)
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)))
