import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const phoneDir = join(root, 'phone')
const otaDir = join(root, 'docs', 'ota')
const indexPath = join(phoneDir, 'index.html')

const BOOT = `<script data-h2-ota-boot="1">(function(){try{var k="h2.ota.bundle.v1";var raw=localStorage.getItem(k);if(!raw)return;var p=JSON.parse(raw);if(!p||p.verified!==true||!p.html||!p.sha256||!p.builtAt)return;if(window.__H2_OTA_APPLIED__)return;window.__H2_OTA_APPLIED__=true;document.open();document.write(p.html);document.close()}catch(e){}})();</script>`

function inlineRefs(html) {
  let out = html
  for (const name of ['calendar.jpg', 'timetable.jpg']) {
    const file = join(phoneDir, 'refs', name)
    if (!existsSync(file)) continue
    const b64 = readFileSync(file).toString('base64')
    const data = `data:image/jpeg;base64,${b64}`
    const patterns = [
      new RegExp(`(\\.\\/refs\\/${name})`, 'g'),
      new RegExp(`(refs\\/${name})`, 'g'),
      new RegExp(`(\\.\\/\\.\\/refs\\/${name})`, 'g'),
    ]
    for (const re of patterns) out = out.replace(re, data)
  }
  return out
}

function stripBoot(html) {
  return html.replace(/<script data-h2-ota-boot="1">[\s\S]*?<\/script>/, '')
}

function injectBoot(html) {
  const cleaned = stripBoot(html)
  if (/<body[^>]*>/i.test(cleaned)) {
    return cleaned.replace(/<body([^>]*)>/i, (m) => `${m}${BOOT}`)
  }
  return BOOT + cleaned
}

if (!existsSync(indexPath)) {
  console.error('missing phone/index.html — run build:phone first')
  process.exit(1)
}

const builtAt = new Date().toISOString()
let raw = readFileSync(indexPath, 'utf8')
raw = injectBoot(raw)
writeFileSync(indexPath, raw)

// OTA payload: full app with images inlined, WITHOUT boot (避免循环 write)
let payload = stripBoot(raw)
payload = inlineRefs(payload)
// mark so调试时能认
payload = payload.replace(
  '</head>',
  `<meta name="h2-ota-built-at" content="${builtAt}" /></head>`,
)

const sha256 = createHash('sha256').update(payload, 'utf8').digest('hex')
mkdirSync(otaDir, { recursive: true })
writeFileSync(join(otaDir, 'app.html'), payload)
const manifest = {
  builtAt,
  sha256,
  bytes: Buffer.byteLength(payload, 'utf8'),
  path: 'docs/ota/app.html',
}
writeFileSync(join(otaDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')

console.log(
  `ota ready builtAt=${builtAt} sha256=${sha256.slice(0, 12)}… bytes=${manifest.bytes}`,
)
