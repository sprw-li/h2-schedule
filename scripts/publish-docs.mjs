import { cpSync, existsSync, mkdirSync, rmSync, readFileSync, readdirSync, copyFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const tmp = join(root, 'docs-build-tmp')
const docs = join(root, 'docs')
const keep = new Set(['schedule.json'])

/**
 * Pages 构建默认 mode=production，只会读 .env / .env.production，
 * 而 CLab 根地址一直写在 .env.phone 里 —— 于是网页产物从来没带上校地址。
 * 这里显式把 .env.phone 里的 VITE_CAMPUS_ORIGIN 透传给子进程。
 * 只取这一个非秘密键；账密（VITE_CAMPUS_USER/PASS）永不读取、永不进产物。
 */
function campusOriginFromEnvFile() {
  const fromProcess = (process.env.VITE_CAMPUS_ORIGIN ?? '').trim()
  if (fromProcess) return fromProcess
  const file = join(root, '.env.phone')
  if (!existsSync(file)) return ''
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*VITE_CAMPUS_ORIGIN\s*=\s*(.*?)\s*$/.exec(line)
    if (m) return m[1].replace(/^["']|["']$/g, '')
  }
  return ''
}

const env = { ...process.env, GITHUB_PAGES: 'true' }
const campusOrigin = campusOriginFromEnvFile()
if (campusOrigin) env.VITE_CAMPUS_ORIGIN = campusOrigin
else console.warn('warn: VITE_CAMPUS_ORIGIN 未设置，网页产物不带 CLab 根地址')

const r = spawnSync('npx', ['vite', 'build', '--outDir', 'docs-build-tmp'], {
  cwd: root,
  env,
  stdio: 'inherit',
  shell: true,
})
if (r.status !== 0) process.exit(r.status ?? 1)

if (!existsSync(tmp)) {
  console.error('missing docs-build-tmp')
  process.exit(1)
}

mkdirSync(docs, { recursive: true })
for (const name of ['index.html', 'assets', 'favicon.svg', 'unlock.json', 'sample.csv', 'sample.json', 'sample.ics']) {
  const from = join(tmp, name)
  if (!existsSync(from)) continue
  const to = join(docs, name)
  rmSync(to, { recursive: true, force: true })
  cpSync(from, to, { recursive: true })
}

// docs/schedule.json 是 App 唯一读写路径（Pages 站点根 + Contents API 路径），
// public/schedule.json 是唯一编辑源。每次构建无条件逐字节同步，避免两份各自演化漂移。
const publicSchedule = join(root, 'public', 'schedule.json')
if (existsSync(publicSchedule)) {
  copyFileSync(publicSchedule, join(docs, 'schedule.json'))
} else {
  console.warn('warn: public/schedule.json 缺失，docs/schedule.json 未同步')
}

// GitHub Pages 常缓存旧 index.html，仍会请求上一轮 hash。把本轮包再写一份旧文件名，缓存命中也能拿到新逻辑。
const assetsDir = join(docs, 'assets')
if (existsSync(assetsDir)) {
  const names = readdirSync(assetsDir)
  const js = names.find((n) => /^index-.*\.js$/.test(n))
  const css = names.find((n) => /^index-.*\.css$/.test(n))
  const aliasJs = ['index-uB_jgYOj.js', 'index-DNqgafjr.js', 'index-BtpLKraA.js']
  const aliasCss = ['index-BHMOI57z.css', 'index-8VWqQ_XF.css', 'index-CKfylkJD.css']
  if (js) {
    for (const a of aliasJs) {
      if (js !== a) copyFileSync(join(assetsDir, js), join(assetsDir, a))
    }
  }
  if (css) {
    for (const a of aliasCss) {
      if (css !== a) copyFileSync(join(assetsDir, css), join(assetsDir, a))
    }
  }
}

void keep
rmSync(tmp, { recursive: true, force: true })
console.log('docs/ updated (schedule.json synced from public/)')
