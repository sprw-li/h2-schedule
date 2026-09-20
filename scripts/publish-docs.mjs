import { cpSync, existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
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

void keep
rmSync(tmp, { recursive: true, force: true })
console.log('docs/ updated (schedule.json kept)')
