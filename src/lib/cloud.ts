import { flattenItems } from './backup'
import { fetchTextNoThrow, ghApiContents, ghPages, ghRaw, netErr } from './net'
import { campusIsLive, campusUrl, getCampusOrigin } from './origin'
import { normalizeSchedule, parseScheduleJsonText, serializeSchedule } from './schedule'
import { loadRemoteSnap } from './sync'
import type { ScheduleMap } from '../types'

const PATH = 'docs/schedule.json'
const TOKEN_KEY = 'h2-schedule.write-token'
const API = ghApiContents(PATH)
const BUNDLED_JSON = `${import.meta.env.BASE_URL}schedule.json`

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

async function pullFromCampus(): Promise<{ map: ScheduleMap; sha: string } | null> {
  const url = campusUrl('schedule.json')
  if (!url) return null
  try {
    const res = await fetch(`${url}?ts=${Date.now()}`)
    if (!res.ok) return null
    const { items } = parseScheduleJsonText(await res.text())
    return { map: normalizeSchedule(items), sha: headerSha(res) }
  } catch {
    return null
  }
}

async function pushCampus(map: ScheduleMap, sha: string) {
  const url = campusUrl('schedule.json')
  if (!url) throw new Error('未配置校服务器')
  const token = getWriteToken()
  if (!token) throw new Error('需要口令才能同步')
  const payload = serializeSchedule(normalizeSchedule(map))
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
  if (sha && !sha.startsWith('sig:')) headers['If-Match'] = `"${sha}"`
  const res = await fetch(url, { method: 'PUT', headers, body: payload })
  if (res.status === 401 || res.status === 403) throw new Error('口令无效或权限不足')
  if (res.status === 409) throw new Error('冲突')
  if (!res.ok) throw new Error('同步失败')
  try {
    const body = (await res.json()) as { sha?: string }
    return body.sha || headerSha(res) || sha
  } catch {
    return headerSha(res) || sha
  }
}

async function pullFromApi(): Promise<{ map: ScheduleMap; sha: string } | null> {
  const token = getWriteToken()
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' }
  if (token) headers.Authorization = `Bearer ${token}`
  try {
    const res = await fetch(`${API}?ts=${Date.now()}`, { headers })
    if (!res.ok) return null
    const body = (await res.json()) as { content?: string; sha?: string }
    return parseContents(body)
  } catch {
    return null
  }
}

function guardAgainstWipe(map: ScheduleMap) {
  const clean = normalizeSchedule(map)
  const localCount = flattenItems(clean).length
  const snap = loadRemoteSnap()
  const snapCount = snap ? flattenItems(snap).length : 0
  if (snapCount >= 80 && localCount === 0) {
    throw new Error('本机日程是空的，拒绝覆盖云端')
  }
  if (snapCount >= 40 && localCount > 0 && localCount * 2 < snapCount) {
    throw new Error('本机条数不到云端一半，拒绝覆盖云端')
  }
  return clean
}

/** GitHub 仅备份，失败不影响校内即时状态 */
async function backupToGithub(map: ScheduleMap) {
  const token = getWriteToken()
  if (!token) return
  const payload = serializeSchedule(normalizeSchedule(map))
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
  try {
    const meta = await fetch(`${API}?ts=${Date.now()}`, {
      headers: { Accept: headers.Accept, Authorization: headers.Authorization },
    })
    let useSha = ''
    if (meta.ok) {
      const body = (await meta.json()) as { sha?: string }
      useSha = body.sha ?? ''
    }
    const putBody = (sha: string) =>
      JSON.stringify({
        message: 'Backup schedule from campus',
        content: encodeBase64(payload),
        branch: 'main',
        ...(sha ? { sha } : {}),
      })
    let res = await fetch(API, { method: 'PUT', headers, body: putBody(useSha) })
    if (res.status === 409 && useSha) {
      const again = await fetch(`${API}?ts=${Date.now()}`, {
        headers: { Accept: headers.Accept, Authorization: headers.Authorization },
      })
      if (again.ok) {
        const body = (await again.json()) as { sha?: string }
        res = await fetch(API, { method: 'PUT', headers, body: putBody(body.sha ?? '') })
      }
    }
    if (!res.ok) return
  } catch {
    /* 校园网打不开 GitHub 时备份以后再补 */
  }
}

/**
 * 配了校服务器：只认校内（即时真相源）。GitHub 不参与读，避免旧备份盖掉校内。
 * 未配置：Contents API → raw → Pages → 打包文件。
 */
export async function pullCloud(): Promise<{ map: ScheduleMap; sha: string } | null> {
  if (campusIsLive()) {
    const campus = await pullFromCampus()
    if (campus) return campus
    throw new Error('校服务器读不到（未改用 GitHub，以免旧备份覆盖）')
  }

  const token = getWriteToken()
  if (token) {
    const api = await pullFromApi()
    if (api) return api
  }

  const [raw, pages] = await Promise.all([pullJsonUrl(ghRaw(PATH)), pullJsonUrl(ghPages(PATH))])
  if (raw) return raw
  if (pages) return pages

  if (!token) {
    const api = await pullFromApi()
    if (api) return api
  }

  try {
    const res = await fetch(`${BUNDLED_JSON}?ts=${Date.now()}`)
    if (res.status === 404) return { map: {}, sha: '' }
    if (!res.ok) throw new Error('读取日程失败')
    const { items } = parseScheduleJsonText(await res.text())
    return { map: normalizeSchedule(items), sha: '' }
  } catch (e) {
    throw new Error(netErr(e, '读取日程失败'))
  }
}

export async function pushCloud(map: ScheduleMap, sha: string) {
  const token = getWriteToken()
  if (!token) throw new Error('需要口令才能同步')
  const clean = guardAgainstWipe(map)

  if (getCampusOrigin()) {
    const campusSha = await pushCampus(clean, sha)
    void backupToGithub(clean)
    return campusSha
  }

  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
  const payload = serializeSchedule(clean)

  async function put(useSha: string) {
    return fetch(API, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        message: 'Update public schedule',
        content: encodeBase64(payload),
        branch: 'main',
        ...(useSha ? { sha: useSha } : {}),
      }),
    })
  }

  try {
    let useSha = sha
    if (!useSha || useSha.startsWith('sig:')) {
      const meta = await fetch(`${API}?ts=${Date.now()}`, {
        headers: { Accept: headers.Accept, Authorization: headers.Authorization },
      })
      if (meta.ok) {
        const body = (await meta.json()) as { sha?: string }
        useSha = body.sha ?? ''
      } else {
        useSha = ''
      }
    }

    let res = await put(useSha)
    if (res.status === 409) {
      const meta = await fetch(`${API}?ts=${Date.now()}`, {
        headers: { Accept: headers.Accept, Authorization: headers.Authorization },
      })
      if (!meta.ok) throw new Error('冲突')
      const body = (await meta.json()) as { sha?: string }
      res = await put(body.sha ?? '')
      if (res.status === 409) throw new Error('冲突')
    }
    if (res.status === 401 || res.status === 403) throw new Error('口令无效或权限不足')
    if (!res.ok) throw new Error('同步失败')
    const body = (await res.json()) as { content?: { sha?: string } }
    return body.content?.sha ?? useSha
  } catch (e) {
    if (
      e instanceof Error &&
      (e.message === '冲突' ||
        e.message.includes('口令') ||
        e.message === '同步失败' ||
        e.message.includes('拒绝覆盖云端'))
    ) {
      throw e
    }
    throw new Error(netErr(e, '同步失败'))
  }
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
