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
const LEGACY_KEYS = ['h2.ota.bundle.v1']
const API = `https://api.github.com/repos/${OWNER}/${REPO}/contents`

declare const __H2_BUILT_AT__: string | undefined

export function bundledBuiltAt() {
  try {
    if (typeof __H2_BUILT_AT__ === 'string' && __H2_BUILT_AT__) return __H2_BUILT_AT__
  } catch {
    /* ignore */
  }
  return ''
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

export function localBuiltAt() {
  return loadLocalBundle()?.builtAt || bundledBuiltAt() || '本机打包'
}


export function clearLocalBundle() {
  try {
    localStorage.removeItem(STORAGE_KEY)
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
  const body = (await res.json()) as { content?: string; encoding?: string; size?: number }
  if (!body.content) throw new Error('更新文件是空的')
  const b64 = body.content.replace(/\n/g, '')
  // GitHub may return utf-8 text as base64
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
  return Date.parse(remoteBuiltAt) > Date.parse(local)
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
  // localStorage ~5MB；整包约数百 KB
  localStorage.setItem(STORAGE_KEY, JSON.stringify(bundle))
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
