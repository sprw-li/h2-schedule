import { fetchTextNoThrow, ghApiContents, ghPages, ghRaw } from './net'
import { campusAuthHeaders, campusUrl, getSyncSource } from './origin'
import { normalizeSchedule, parseScheduleJsonText, serializeSchedule } from './schedule'
import { loadGithubSha, saveGithubSha } from './sync'
import type { ScheduleMap } from '../types'

const PATH = 'docs/schedule.json'
const TOKEN_KEY = 'h2-schedule.write-token'
const API = ghApiContents(PATH)

export function getWriteToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? ''
  } catch {
    return ''
  }
}

export function setWriteToken(token: string) {
  const t = token.trim()
  if (!t) localStorage.removeItem(TOKEN_KEY)
  else localStorage.setItem(TOKEN_KEY, t)
}

function parseContents(body: { content?: string; sha?: string }) {
  if (!body.content) return null
  const text = decodeBase64(body.content.replace(/\n/g, ''))
  const { items } = parseScheduleJsonText(text)
  return {
    map: normalizeSchedule(items),
    sha: body.sha ?? '',
  }
}

async function pullJsonUrl(url: string): Promise<{ map: ScheduleMap; sha: string } | null> {
  const text = await fetchTextNoThrow(url)
  if (!text) return null
  try {
    const { items } = parseScheduleJsonText(text)
    return { map: normalizeSchedule(items), sha: '' }
  } catch {
    return null
  }
}

function headerSha(res: Response) {
  const raw = (res.headers.get('x-h2-sha') || res.headers.get('etag') || '').trim()
  return raw.replace(/^W\//, '').replace(/"/g, '')
}

export function isCampusAuthError(err: unknown) {
  return err instanceof Error && (err.message.includes('CLab 登录') || err.message.includes('校服务器账密'))
}

async function pullFromCampus(): Promise<{ map: ScheduleMap; sha: string } | null> {
  const url = campusUrl('schedule.json')
  if (!url) return null
  try {
    const res = await fetch(`${url}?ts=${Date.now()}`, { headers: campusAuthHeaders() })
    if (res.status === 401 || res.status === 403) throw new Error('CLab 登录失败（其他功能里核对应预填的用户名和密码）')
    if (!res.ok) return null
    const { items } = parseScheduleJsonText(await res.text())
    return { map: normalizeSchedule(items), sha: headerSha(res) }
  } catch (e) {
    if (isCampusAuthError(e)) throw e
    return null
  }
}

function campusWriteHeaders() {
  const auth = campusAuthHeaders()
  const token = getWriteToken()
  if (!auth.Authorization && !token) return null
  return {
    ...auth,
    ...(auth.Authorization ? {} : { Authorization: `Bearer ${token}` }),
    'Content-Type': 'application/json',
  } as Record<string, string>
}

async function pullFromApi(): Promise<{ map: ScheduleMap; sha: string } | null> {
  const token = getWriteToken()
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' }
  if (token) headers.Authorization = `Bearer ${token}`
  try {
    const res = await fetch(`${API}?ts=${Date.now()}`, { headers })
    if (!res.ok) return null
    const body = (await res.json()) as { content?: string; sha?: string }
    const parsed = parseContents(body)
    // 记住这次读到的 GitHub blob sha：镜像只在远端仍是这个 sha 时才写
    if (parsed?.sha) saveGithubSha(parsed.sha)
    return parsed
  } catch {
    return null
  }
}

/**
 * 把当前日程写入 GitHub docs/schedule.json。CLab 入口成功读写后调用。
 *
 * 只在「已知 sha 且与远端当前 sha 一致」时写：拿不到 sha 或不匹配就放弃返回 false。
 * 不再「409 后重取最新 sha 再盖」——那是最后写赢，会把别处刚提交的数据冲掉。
 * 宁可这次不同步，也不要盲盖。
 */
export async function mirrorScheduleToGithub(map: ScheduleMap) {
  const token = getWriteToken()
  if (!token) return false
  const known = loadGithubSha()
  if (!known) return false
  const payload = serializeSchedule(normalizeSchedule(map))
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
  for (let i = 0; i < 3; i++) {
    try {
      const meta = await fetch(`${API}?ts=${Date.now()}`, {
        headers: { Accept: headers.Accept, Authorization: headers.Authorization },
      })
      if (!meta.ok) return false
      const body = (await meta.json()) as { sha?: string }
      // sha 不匹配：远端已被别处改过，放弃本次镜像
      if (!body.sha || body.sha !== known) return false
      const res = await fetch(API, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          message: 'Sync schedule to GitHub',
          content: encodeBase64(payload),
          branch: 'main',
          sha: known,
        }),
      })
      if (res.ok) {
        const out = (await res.json()) as { content?: { sha?: string } }
        if (out.content?.sha) saveGithubSha(out.content.sha)
        return true
      }
      if (res.status === 409) return false
    } catch {
      /* 校园网常打不开 GitHub，下一轮再试 */
    }
    await new Promise((r) => setTimeout(r, 400 * (i + 1)))
  }
  return false
}

/** 把当前日程写入 CLab。GitHub 入口成功读写后调用（校园网不可达时静默失败）。 */
export async function mirrorScheduleToCampus(map: ScheduleMap) {
  const url = campusUrl('schedule.json')
  if (!url) return false
  const headers = campusWriteHeaders()
  if (!headers) return false
  const payload = serializeSchedule(normalizeSchedule(map))
  for (let i = 0; i < 3; i++) {
    try {
      const meta = await fetch(`${url}?ts=${Date.now()}`, { headers })
      let sha = ''
      if (meta.ok) sha = headerSha(meta)
      const putHeaders = { ...headers }
      if (sha && !sha.startsWith('sig:')) putHeaders['If-Match'] = `"${sha}"`
      const res = await fetch(url, { method: 'PUT', headers: putHeaders, body: payload })
      if (res.ok) return true
      if (res.status !== 409) return false
    } catch {
      /* 家里网常打不开 CLab，下一轮再试 */
    }
    await new Promise((r) => setTimeout(r, 400 * (i + 1)))
  }
  return false
}

function rememberGithub(got: { map: ScheduleMap; sha: string }) {
  return got
}

/**
 * 顶栏明确选入口：CLab 只读写校内；GitHub 只读写仓库。
 * 拉取只读，绝不作为副作用写入另一端——那会把 CDN 旧缓存（raw / Pages）
 * 当成真相写进 CLab，是「课表被旧数据反复覆盖」最阴的污染源。
 * 镜像只允许发生在「本机自己成功写入之后」（见 pushCloud）。
 */
export async function pullCloud(): Promise<{ map: ScheduleMap; sha: string } | null> {
  if (getSyncSource() === 'clab') {
    const campus = await pullFromCampus()
    if (!campus) throw new Error('CLab 连不上（未改用 GitHub，可改点顶栏 GitHub）')
    return campus
  }

  const token = getWriteToken()
  if (token) {
    const api = await pullFromApi()
    if (api) return rememberGithub(api)
  }

  const [raw, pages] = await Promise.all([pullJsonUrl(ghRaw(PATH)), pullJsonUrl(ghPages(PATH))])
  if (raw) return rememberGithub(raw)
  if (pages) return rememberGithub(pages)

  if (!token) {
    const api = await pullFromApi()
    if (api) return rememberGithub(api)
  }

  // 禁止 fetch 包内 / APK 的 schedule.json：那不是云端。当成 remote 再 merge
  // 会把已删条目（如化安）加回来。失败则返回 null，App 继续用 localStorage。
  return null
}

/**
 * 只读收集「旧客户端可能整表写过」的公开面，供 catch-up 桥对比 h2-data snapshot。
 * 读路径不写任何源。校内可达时优先收 CLab；再收 GitHub docs（API → raw → Pages）。
 */
export async function pullLegacyPublicMaps(): Promise<ScheduleMap[]> {
  const maps: ScheduleMap[] = []

  try {
    const campus = await pullFromCampus()
    if (campus?.map) maps.push(campus.map)
  } catch {
    /* campus auth/network — skip this face */
  }

  const token = getWriteToken()
  if (token) {
    const api = await pullFromApi()
    if (api?.map) maps.push(api.map)
  }
  const [raw, pages] = await Promise.all([pullJsonUrl(ghRaw(PATH)), pullJsonUrl(ghPages(PATH))])
  if (raw?.map) maps.push(raw.map)
  if (pages?.map) maps.push(pages.map)
  if (!token) {
    const api = await pullFromApi()
    if (api?.map) maps.push(api.map)
  }

  return maps
}

/**
 * P1：整表推 docs/schedule.json / CLab 已退役。
 * 正本在 h2-data op 日志；公开快照由 reducer Action 覆盖。
 * 保留函数签名以免旧调用崩——一律拒绝，引导走 flushOps。
 */
export async function pushCloud(_map: ScheduleMap, _sha: string): Promise<string> {
  throw new Error('已改用 op 同步（h2-data）；请升级客户端，勿整表覆盖 docs/schedule.json')
}

/** @deprecated P1 退役：客户端不再镜像整表到代码仓 */
export async function mirrorScheduleToGithubRetired() {
  return false
}

function encodeBase64(text: string) {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  bytes.forEach((b) => {
    bin += String.fromCharCode(b)
  })
  return btoa(bin)
}

function decodeBase64(b64: string) {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}
