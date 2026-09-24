/** 壳内 OTA：经 GitHub Contents API 拉整包 HTML，校验 sha256 后写入 localStorage，重启由 boot 装配 */

import { getWriteToken } from './cloud'
import { ghPages, ghRaw, netErr } from './net'
import { campusAuthHeaders, campusUrl, getCampusOrigin } from './origin'

/** OTA 包的来源。manifest 与 html 必须来自同一个源（否则 sha256 必然对不上）。 */
export type OtaSource = 'clab' | 'raw' | 'pages' | 'api'

export type OtaManifest = {
  builtAt: string
  sha256: string
  bytes: number
  path: string
  /** 这份 manifest 实际来自哪个源。运行时附注，不写回远端、不参与校验。 */
  source?: OtaSource
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
const APPLIED_KEY = 'h2.ota.applied-built-at'
const LEGACY_KEYS = ['h2.ota.bundle.v1']
const API = `https://api.github.com/repos/${OWNER}/${REPO}/contents`

declare const __H2_BUILT_AT__: string | undefined

/** OTA 只给 Capacitor 壳用。浏览器 / localhost 已经是当前网页，不必对手机包时间戳。 */
export function isNativeApp() {
  try {
    return !!(window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()
  } catch {
    return false
  }
}

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

function readAppliedBuiltAt() {
  try {
    return localStorage.getItem(APPLIED_KEY)?.trim() || ''
  } catch {
    return ''
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

function validIso(s: string | undefined | null) {
  if (!s || s.includes('PLACEHOLDER')) return ''
  const t = Date.parse(s)
  return Number.isNaN(t) ? '' : s
}

/**
 * 本机时间戳：只认「已装配的 OTA」，不要对壳/页面/缓存取 max。
 * 以前取最新会导致再查一次时又跳回 APK 打包点或无效占位符。
 */
export function localBuiltAt() {
  return (
    validIso(readAppliedBuiltAt()) ||
    validIso(readStoredMeta()?.builtAt) ||
    validIso(loadLocalBundle()?.builtAt) ||
    validIso(metaBuiltAt()) ||
    validIso(bundledBuiltAt()) ||
    '本机打包'
  )
}

export function clearLocalBundle() {
  try {
    localStorage.removeItem(STORAGE_KEY)
    localStorage.removeItem(META_KEY)
    localStorage.removeItem(APPLIED_KEY)
    for (const k of LEGACY_KEYS) localStorage.removeItem(k)
  } catch {
    /* ignore */
  }
}

export async function sha256Hex(text: string) {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) {
    throw new Error('需要 HTTPS 才能校验更新包（请用 github.io 或手机 App）')
  }
  const buf = await subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function authHeaders(raw = false): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: raw ? 'application/vnd.github.raw' : 'application/vnd.github+json',
  }
  const token = getWriteToken()
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

async function fetchText(url: string, init?: RequestInit, tries = 2): Promise<string> {
  let last: unknown
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`${url}${url.includes('?') ? '&' : '?'}ts=${Date.now()}`, init)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.text()
    } catch (e) {
      last = e
      if (i + 1 < tries) await new Promise((r) => setTimeout(r, 400 * (i + 1)))
    }
  }
  throw new Error(netErr(last))
}

function pagesUrl(repoPath: string) {
  return ghPages(repoPath)
}

async function readViaRaw(path: string) {
  const text = await fetchText(ghRaw(path), undefined, path.endsWith('.html') ? 3 : 2)
  if (path.endsWith('.json')) {
    JSON.parse(text)
    return text
  }
  if (text.includes('id="root"') || text.length > 5000) return text
  throw new Error('raw 内容无效')
}

async function readViaCampus(path: string) {
  const url = campusUrl(path)
  if (!url) throw new Error('未配置校服务器')
  const headers = campusAuthHeaders()
  const text = await fetchText(url, headers.Authorization ? { headers } : undefined, path.endsWith('.html') ? 3 : 2)
  if (path.endsWith('.json')) {
    JSON.parse(text)
    return text
  }
  if (text.includes('id="root"') || text.length > 5000) return text
  throw new Error('校服务器内容无效')
}

async function readViaPages(path: string) {
  const text = await fetchText(pagesUrl(path), undefined, path.endsWith('.html') ? 3 : 2)
  if (path.endsWith('.json')) {
    JSON.parse(text)
    return text
  }
  if (text.includes('id="root"') || text.length > 5000) return text
  throw new Error('Pages 内容无效')
}

async function readViaApi(path: string) {
  const token = getWriteToken()
  if (!token) throw new Error('需要口令才能走 GitHub API')

  const rawRes = await fetch(`${API}/${path}?ts=${Date.now()}`, { headers: authHeaders(true) })
  if (rawRes.status === 401 || rawRes.status === 403) throw new Error('口令无效或权限不足')
  if (rawRes.ok) {
    const text = await rawRes.text()
    if (path.endsWith('.json')) {
      try {
        JSON.parse(text)
        return text
      } catch {
        /* fall through */
      }
    } else if (text.includes('id="root"') || text.length > 5000) {
      return text
    }
  }

  const res = await fetch(`${API}/${path}?ts=${Date.now()}`, { headers: authHeaders(false) })
  if (res.status === 401 || res.status === 403) throw new Error('口令无效或权限不足')
  if (!res.ok) throw new Error('暂时查不到更新')

  const body = (await res.json()) as { content?: string; download_url?: string }
  if (body.content) {
    const b64 = body.content.replace(/\n/g, '')
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new TextDecoder().decode(bytes)
  }
  if (body.download_url) {
    const raw = await fetch(body.download_url, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (raw.ok) return await raw.text()
  }
  throw new Error('暂时查不到更新')
}

function parseMan(text: string, source: OtaSource): OtaManifest | null {
  try {
    const man = JSON.parse(text) as OtaManifest
    if (!man.builtAt || !man.sha256 || !man.path) return null
    return { ...man, source }
  } catch {
    return null
  }
}

type SourceReader = { source: OtaSource; read: (p: string) => Promise<string>; label: string }

/**
 * 全部可达来源，**与顶栏选的同步源无关**。
 * 只配了校地址才试 CLab；有口令才试 API。CLab 失败不静默，记下原因给用户看。
 */
function otaSources(): SourceReader[] {
  const list: SourceReader[] = []
  if (getCampusOrigin()) list.push({ source: 'clab', read: readViaCampus, label: 'CLab' })
  list.push({ source: 'raw', read: readViaRaw, label: 'GitHub raw' })
  list.push({ source: 'pages', read: readViaPages, label: 'GitHub Pages' })
  if (getWriteToken()) list.push({ source: 'api', read: readViaApi, label: 'GitHub API' })
  return list
}

/**
 * 取最新的 manifest：不挑源，逐个试（CLab 可用时先试），按 builtAt 取最新。
 * 某源查不到或坏包只记原因，不影响其他源；全失败才抛错并列出每个源的原因。
 */
export async function fetchManifest(): Promise<OtaManifest> {
  const cands: OtaManifest[] = []
  const errs: string[] = []
  for (const { source, read, label } of otaSources()) {
    try {
      const p = parseMan(await read(MANIFEST_PATH), source)
      if (p) cands.push(p)
      else errs.push(`${label}：manifest 内容无效`)
    } catch (e) {
      errs.push(`${label}：${netErr(e, `${label} 查不到更新`)}`)
    }
  }
  if (cands.length === 0) {
    throw new Error(errs.join('；') || '查不到更新（可开代理或输入口令后重试）')
  }
  cands.sort((a, b) => Date.parse(b.builtAt) - Date.parse(a.builtAt))
  return cands[0]
}

export function isNewer(remoteBuiltAt: string, local: string) {
  if (!remoteBuiltAt) return false
  if (!local || local === '本机打包' || local.includes('PLACEHOLDER')) return true
  const r = Date.parse(remoteBuiltAt)
  const l = Date.parse(local)
  if (Number.isNaN(r)) return false
  if (Number.isNaN(l)) return true
  return r - l > 2000
}

/**
 * 下载整包 html：**必须与 manifest 同一个源**（否则 sha256 对不上）。
 * 先试 manifest 的来源（命中率高、省流量），再依次试其他可达来源；
 * 每源下载后立即校验 sha256，不匹配就换下一源，不要立刻放弃。
 */
export async function downloadAndVerify(man: OtaManifest): Promise<OtaBundle> {
  const tryHtml = async (read: (p: string) => Promise<string>) => {
    const html = await read(man.path)
    const digest = await sha256Hex(html)
    if (digest !== man.sha256) throw new Error('sha mismatch')
    if (html.length < 1000 || !html.includes('id="root"')) throw new Error('更新包无效，请稍后再试')
    return html
  }

  const all = otaSources()
  const preferred = all.filter((s) => s.source === man.source)
  const rest = all.filter((s) => s.source !== man.source)
  let html = ''
  const errs: string[] = []
  for (const { read, label } of [...preferred, ...rest]) {
    try {
      html = await tryHtml(read)
      if (html) break
    } catch (e) {
      errs.push(`${label}：${netErr(e, `${label} 下载失败`)}`)
    }
  }
  if (!html) {
    const why = errs.some((e) => e.includes('sha mismatch')) ? '包已找到但校验不过' : '下载不到'
    throw new Error(`${why}（${errs.join('；') || '请再试一次'}）`)
  }

  return {
    builtAt: man.builtAt,
    sha256: man.sha256,
    html,
    verified: true,
    appliedAt: new Date().toISOString(),
  }
}

export function saveBundle(bundle: OtaBundle) {
  localStorage.setItem(APPLIED_KEY, bundle.builtAt)
  localStorage.setItem(
    META_KEY,
    JSON.stringify({ builtAt: bundle.builtAt, sha256: bundle.sha256, appliedAt: bundle.appliedAt }),
  )
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bundle))
  } catch (e) {
    console.warn('ota html save failed', e)
    throw new Error('本机空间不够，请清理后重试')
  }
}

export async function checkForUpdate() {
  const man = await fetchManifest()
  // 已装过同版本但缺 applied 标记时补上，避免「再查一次」跳回壳时间
  const bundle = loadLocalBundle()
  if (bundle?.builtAt === man.builtAt && !validIso(readAppliedBuiltAt())) {
    try {
      localStorage.setItem(APPLIED_KEY, man.builtAt)
    } catch {
      /* ignore */
    }
  }
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
