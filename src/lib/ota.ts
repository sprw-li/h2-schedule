/** 壳内 OTA：经 GitHub Contents API 拉整包 HTML，校验 sha256 后写入 localStorage，重启由 boot 装配 */

import { getWriteToken } from './cloud'
import { netErr } from './net'

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
const APPLIED_KEY = 'h2.ota.applied-built-at'
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
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
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
  // docs/ota/manifest.json → /h2-schedule/ota/manifest.json
  const rel = repoPath.replace(/^docs\//, '')
  return `https://sprw-li.github.io/h2-schedule/${rel}`
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

function parseMan(text: string): OtaManifest | null {
  try {
    const man = JSON.parse(text) as OtaManifest
    if (!man.builtAt || !man.sha256 || !man.path) return null
    return man
  } catch {
    return null
  }
}

/** Pages 常有缓存；有口令时两边都拉，取较新的 manifest */
export async function fetchManifest(): Promise<OtaManifest> {
  const cands: OtaManifest[] = []
  try {
    const p = parseMan(await readViaPages(MANIFEST_PATH))
    if (p) cands.push(p)
  } catch {
    /* ignore */
  }
  if (getWriteToken()) {
    try {
      const a = parseMan(await readViaApi(MANIFEST_PATH))
      if (a) cands.push(a)
    } catch {
      /* ignore */
    }
  }
  if (cands.length === 0) {
    // 无口令且 Pages 失败
    throw new Error('查不到更新（可开代理或输入口令后重试）')
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

export async function downloadAndVerify(man: OtaManifest): Promise<OtaBundle> {
  const tryHtml = async (reader: (p: string) => Promise<string>) => {
    const html = await reader(man.path)
    const digest = await sha256Hex(html)
    if (digest !== man.sha256) throw new Error('sha mismatch')
    if (html.length < 1000 || !html.includes('id="root"')) throw new Error('更新包无效，请稍后再试')
    return html
  }

  let html = ''
  const errs: string[] = []
  // API 优先（刚推的包），再 Pages
  if (getWriteToken()) {
    try {
      html = await tryHtml(readViaApi)
    } catch (e) {
      errs.push(netErr(e, 'API 下载失败'))
    }
  }
  if (!html) {
    try {
      html = await tryHtml(readViaPages)
    } catch (e) {
      errs.push(netErr(e, 'Pages 下载失败'))
    }
  }
  if (!html) {
    throw new Error(errs.join('；') || '下载不完整，请再试一次')
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
