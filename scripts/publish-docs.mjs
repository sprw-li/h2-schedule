import { cpSync, existsSync, mkdirSync, rmSync, readFileSync, writeFileSync, readdirSync, copyFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const tmp = join(root, 'docs-build-tmp')
const docs = join(root, 'docs')
const keep = new Set(['schedule.json'])

const env = { ...process.env, GITHUB_PAGES: 'true' }
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

if (!existsSync(join(docs, 'schedule.json')) && existsSync(join(root, 'public', 'schedule.json'))) {
  writeFileSync(join(docs, 'schedule.json'), readFileSync(join(root, 'public', 'schedule.json')))
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
console.log('docs/ updated (schedule.json kept)')
