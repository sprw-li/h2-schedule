import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const phoneDir = join(root, 'phone')
const otaDir = join(root, 'docs', 'ota')
const indexPath = join(phoneDir, 'index.html')
const PLACEHOLDER = '__H2_BUILT_AT_PLACEHOLDER__'

// 只丢掉坏包/全屏遮罩包；不要用壳时间戳清掉已装配的更新（否则本机永远停在 APK 打包点）
const BOOT_TEMPLATE = `<script data-h2-ota-boot="1">(function(){try{var k="h2.ota.bundle.v2";try{localStorage.removeItem("h2.ota.bundle.v1")}catch(e){}var raw=localStorage.getItem(k);if(!raw)return;var p=JSON.parse(raw);if(!p||p.verified!==true||!p.html||!p.sha256||!p.builtAt){localStorage.removeItem(k);return}if(p.html.indexOf("update-scrim")>=0){localStorage.removeItem(k);return}if(window.__H2_OTA_APPLIED__)return;window.__H2_OTA_APPLIED__=true;document.open();document.write(p.html);document.close()}catch(e){console.warn("h2-ota-boot",e)}})();</script>`

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
  const boot = BOOT_TEMPLATE
  const cleaned = stripBoot(html)
  if (/<body[^>]*>/i.test(cleaned)) {
    return cleaned.replace(/<body([^>]*)>/i, (m) => `${m}${boot}`)
  }
  return boot + cleaned
}

function stampBuiltAt(html, builtAt) {
  let out = html.split(PLACEHOLDER).join(builtAt)
  if (/<meta\s+name="h2-ota-built-at"/i.test(out)) {
    out = out.replace(
      /<meta\s+name="h2-ota-built-at"\s+content="[^"]*"\s*\/?>/i,
      `<meta name="h2-ota-built-at" content="${builtAt}" />`,
    )
  } else {
    out = out.replace(/<\/head>/i, `<meta name="h2-ota-built-at" content="${builtAt}" /></head>`)
  }
  return out
}

if (!existsSync(indexPath)) {
  console.error('missing phone/index.html — run build:phone first')
  process.exit(1)
}

const builtAt = new Date().toISOString()
let raw = readFileSync(indexPath, 'utf8')
raw = stampBuiltAt(raw, builtAt)
raw = injectBoot(raw)
writeFileSync(indexPath, raw)

let payload = stripBoot(raw)
payload = inlineRefs(payload)
payload = stampBuiltAt(payload, builtAt)

// 把当前口令包嵌进 OTA，避免手机去拉私有仓 unlock.json 失败而仍用旧 APK 内文件
const unlockPath = join(root, 'public', 'unlock.json')
if (existsSync(unlockPath)) {
  const unlockJson = readFileSync(unlockPath, 'utf8').trim()
  const tag = `<script type="application/json" id="h2-unlock-pack">${unlockJson}</script>`
  if (/id="h2-unlock-pack"/i.test(payload)) {
    payload = payload.replace(
      /<script type="application\/json" id="h2-unlock-pack">[\s\S]*?<\/script>/i,
      tag,
    )
  } else {
    payload = payload.replace(/<\/head>/i, `${tag}</head>`)
  }
}

const sha256 = createHash('sha256').update(payload, 'utf8').digest('hex')
mkdirSync(otaDir, { recursive: true })
writeFileSync(join(otaDir, 'app.html'), payload)
const manifest = {
  builtAt,
  sha256,
  bytes: Buffer.byteLength(payload, 'utf8'),
  path: 'docs/ota/app.html',
  storageKey: 'h2.ota.bundle.v2',
}
writeFileSync(join(otaDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')

console.log(
  `ota ready builtAt=${builtAt} sha256=${sha256.slice(0, 12)}… bytes=${manifest.bytes}`,
)
