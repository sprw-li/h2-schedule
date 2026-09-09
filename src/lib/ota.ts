/** 壳内 OTA：经 GitHub Contents API 拉整包 HTML，校验 sha256 后写入 localStorage，重启由 boot 装配 */

export type OtaManifest = {
  builtAt: string
  sha256: string
  bytes: number
  path: string
}

export type OtaBundle = {
  builtAt: string
  sha256: string
  html: string
  verified: true
  appliedAt: string
}

const OWNER = 'sprw-li'
const REPO = 'h2-schedule'
const MANIFEST_PATH = 'docs/ota/manifest.json'
const STORAGE_KEY = 'h2.ota.bundle.v2'
const META_KEY = 'h2.ota.meta.v2'
const LEGACY_KEYS = ['h2.ota.bundle.v1']
const API = `https://api.github.com/repos/${OWNER}/${REPO}/contents`

declare const __H2_BUILT_AT__: string | undefined

export function bundledBuiltAt() {
  try {
    if (typeof __H2_BUILT_AT__ === 'string' && __H2_BUILT_AT__ && !__H2_BUILT_AT__.includes('PLACEHOLDER')) {
      return __H2_BUILT_AT__
    }
  } catch {
    /* ignore */
  }
  return ''
}

function metaBuiltAt() {
  try {
    return document.querySelector('meta[name="h2-ota-built-at"]')?.getAttribute('content')?.trim() || ''
  } catch {
    return ''
  }
}

function readStoredMeta(): { builtAt: string; sha256: string } | null {
  try {
    const raw = localStorage.getItem(META_KEY)
    if (!raw) return null
    const m = JSON.parse(raw) as { builtAt?: string; sha256?: string }
    if (!m.builtAt || !m.sha256) return null
    return { builtAt: m.builtAt, sha256: m.sha256 }
  } catch {
    return null
  }
}

export function loadLocalBundle(): OtaBundle | null {
  try {
    for (const k of LEGACY_KEYS) localStorage.removeItem(k)
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const pack = JSON.parse(raw) as Partial<OtaBundle>
    if (!pack?.verified || !pack.html || !pack.sha256 || !pack.builtAt) return null
    if (pack.html.includes('update-scrim')) {
      localStorage.removeItem(STORAGE_KEY)
      return null
    }
    return pack as OtaBundle
  } catch {
    return null
  }
}

/** 本机当前界面时间戳：优先页面 meta / 已装配包，再退回编译常量 */
export function localBuiltAt() {
  const fromMeta = metaBuiltAt()
  const fromPack = loadLocalBundle()?.builtAt
  const fromStored = readStoredMeta()?.builtAt
  const fromBundle = bundledBuiltAt()
  // 取四者中最新的有效时间，避免装配后仍显示旧壳时间
  const candidates = [fromMeta, fromPack, fromStored, fromBundle].filter(Boolean) as string[]
  if (candidates.length === 0) return '本机打包'
  return candidates.sort((a, b) => Date.parse(b) - Date.parse(a))[0]
}

export function clearLocalBundle() {
  try {
    localStorage.removeItem(STORAGE_KEY)
    localStorage.removeItem(META_KEY)
    for (const k of LEGACY_KEYS) localStorage.removeItem(k)
  } catch {
    /* ignore */
  }
}

export async function sha256Hex(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function readGithubFile(path: string) {
  const res = await fetch(`${API}/${path}?ts=${Date.now()}`, {
    headers: { Accept: 'application/vnd.github+json' },
  })
  if (!res.ok) throw new Error(`读取更新失败（${res.status}）`)
  const body = (await res.json()) as { content?: string; encoding?: string; download_url?: string }
  if (body.download_url) {
    const raw = await fetch(`${body.download_url}${body.download_url.includes('?') ? '&' : '?'}ts=${Date.now()}`)
    if (raw.ok) return await raw.text()
  }
  if (!body.content) throw new Error('更新文件是空的')
  const b64 = body.content.replace(/\n/g, '')
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

export async function fetchManifest(): Promise<OtaManifest> {
  const text = await readGithubFile(MANIFEST_PATH)
  const man = JSON.parse(text) as OtaManifest
  if (!man.builtAt || !man.sha256 || !man.path) throw new Error('更新清单无效')
  return man
}

export function isNewer(remoteBuiltAt: string, local: string) {
  if (!remoteBuiltAt) return false
  if (!local || local === '本机打包') return true
  const r = Date.parse(remoteBuiltAt)
  const l = Date.parse(local)
  if (Number.isNaN(r) || Number.isNaN(l)) return remoteBuiltAt !== local
  // 2 秒内视为同一版，避免毫秒差误报「有更新」
  return r - l > 2000
}

export async function downloadAndVerify(man: OtaManifest): Promise<OtaBundle> {
  const html = await readGithubFile(man.path)
  const digest = await sha256Hex(html)
  if (digest !== man.sha256) {
    throw new Error('校验失败：下载内容与清单不一致')
  }
  if (html.length < 1000 || !html.includes('id="root"')) {
    throw new Error('校验失败：不像有效的应用包')
  }
  return {
    builtAt: man.builtAt,
    sha256: digest,
    html,
    verified: true,
    appliedAt: new Date().toISOString(),
  }
}

export function saveBundle(bundle: OtaBundle) {
  localStorage.setItem(
    META_KEY,
    JSON.stringify({ builtAt: bundle.builtAt, sha256: bundle.sha256, appliedAt: bundle.appliedAt }),
  )
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bundle))
  } catch (e) {
    // 配额不够时至少保住时间戳，提示用户
    console.warn('ota html save failed', e)
    throw new Error('本机空间不够，装不下界面包（可清掉站点数据后重试）')
  }
}

export async function checkForUpdate() {
  const man = await fetchManifest()
  const local = localBuiltAt()
  return {
    manifest: man,
    localBuiltAt: local,
    hasUpdate: isNewer(man.builtAt, local),
  }
}

export async function applyUpdate() {
  const man = await fetchManifest()
  const bundle = await downloadAndVerify(man)
  saveBundle(bundle)
  return bundle
}
