/**
 * 离开 PKU / CLab 不可达时：本机自环模拟校服务器（schedule + OTA）。
 *
 *   npm run campus:local
 *
 * 种子：docs/schedule.json + docs/ota/ → tmp-campus-data/（gitignore）
 * - schedule.json 已存在则保留（不删用户在本机模拟服上改过的数据）
 * - ota/* 每次从 docs/ota 覆盖（跟当前构建产物对齐）
 *
 * 监听 127.0.0.1:8765。真机同 WiFi 调试加 --lan（绑 0.0.0.0），
 * Android 模拟器用 http://10.0.2.2:8765。
 */
import { spawn, spawnSync } from 'node:child_process'
import { copyFile, cp, mkdir, access } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { constants } from 'node:fs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DATA = join(ROOT, 'tmp-campus-data')
const PORT = Number(process.env.H2_CAMPUS_PORT || '8765')
const LAN = process.argv.includes('--lan')
const HOST = LAN ? '0.0.0.0' : '127.0.0.1'
/** 仅本机模拟用，非生产密钥；与 .env.example 一致 */
const LOCAL_USER = process.env.H2_USER || 'local'
const LOCAL_PASS = process.env.H2_PASS || 'local'
const LOCAL_TOKEN = process.env.H2_WRITE_TOKEN || 'h2-local-dev'

function pyBin() {
  if (process.env.H2_PYTHON) return process.env.H2_PYTHON
  const candidates =
    process.platform === 'win32'
      ? ['D:\\python313\\python.exe', 'python', 'py']
      : ['python3', 'python']
  for (const c of candidates) {
    try {
      const r = spawnSync(c, ['-c', 'pass'], { stdio: 'ignore', windowsHide: true })
      if (r.status === 0) return c
    } catch {
      /* try next */
    }
  }
  return candidates[0]
}

async function exists(p) {
  try {
    await access(p, constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function seed() {
  await mkdir(join(DATA, 'ota'), { recursive: true })
  const schedSrc = join(ROOT, 'docs', 'schedule.json')
  const schedDst = join(DATA, 'schedule.json')
  if (!(await exists(schedDst))) {
    if (await exists(schedSrc)) {
      await copyFile(schedSrc, schedDst)
      console.log(`seed: schedule.json ← docs/schedule.json`)
    } else {
      console.warn('seed: docs/schedule.json 缺失，跳过日程种子')
    }
  } else {
    console.log('seed: 保留已有 tmp-campus-data/schedule.json（不覆盖）')
  }
  const otaSrc = join(ROOT, 'docs', 'ota')
  if (await exists(otaSrc)) {
    await cp(otaSrc, join(DATA, 'ota'), { recursive: true })
    console.log('seed: ota/* ← docs/ota/')
  } else {
    console.warn('seed: docs/ota/ 缺失，跳过 OTA 种子')
  }
}

async function main() {
  await seed()
  const py = pyBin()
  const script = join(ROOT, 'scripts', 'campus_sync_server.py')
  console.log('')
  console.log(`本地 CLab 模拟 → http://127.0.0.1:${PORT}`)
  if (LAN) {
    console.log(`LAN 模式已开（0.0.0.0）；真机用电脑局域网 IP:8765；模拟器用 10.0.2.2:${PORT}`)
  }
  console.log(`账密 Basic: ${LOCAL_USER} / ${LOCAL_PASS}  （或 Bearer ${LOCAL_TOKEN}）`)
  console.log(`开发：在「其他功能」填 http://127.0.0.1:${PORT}，或 .env.*.local 写 VITE_CAMPUS_ORIGIN`)
  console.log('Ctrl+C 停止')
  console.log('')

  const child = spawn(
    py,
    [script, '--host', HOST, '--port', String(PORT), '--data-dir', DATA],
    {
      env: {
        ...process.env,
        H2_USER: LOCAL_USER,
        H2_PASS: LOCAL_PASS,
        H2_WRITE_TOKEN: LOCAL_TOKEN,
        PYTHONUNBUFFERED: '1',
      },
      stdio: 'inherit',
      windowsHide: true,
    },
  )
  child.on('error', (err) => {
    console.error(`无法启动 Python（${py}）：${err.message}`)
    console.error('可设环境变量 H2_PYTHON=python 后重试')
    process.exit(1)
  })
  child.on('exit', (code, signal) => {
    if (signal) process.exit(1)
    process.exit(code ?? 0)
  })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
