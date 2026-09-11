import { flattenItems } from './backup'
import { netErr } from './net'
import { normalizeSchedule, parseScheduleJsonText, serializeSchedule } from './schedule'
import type { ScheduleMap } from '../types'

const OWNER = 'sprw-li'
const REPO = 'h2-schedule'
const PATH = 'docs/schedule.json'
const TOKEN_KEY = 'h2-schedule.write-token'
const API = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${PATH}`
const PAGES = 'https://sprw-li.github.io/h2-schedule/schedule.json'
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

async function pullFromPages(): Promise<{ map: ScheduleMap; sha: string } | null> {
  try {
    const res = await fetch(`${PAGES}?ts=${Date.now()}`)
    if (!res.ok) return null
    const { items } = parseScheduleJsonText(await res.text())
    return { map: normalizeSchedule(items), sha: '' }
  } catch {
    return null
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

/**
 * 手机 WebView 常打不通 api.github.com。
 * 先 Pages，再 API（带 sha），最后壳内打包；拉到即 normalize。
 */
export async function pullCloud(): Promise<{ map: ScheduleMap; sha: string } | null> {
  const pages = await pullFromPages()
  const api = await pullFromApi()

  if (pages && api) {
    const pn = flattenItems(pages.map).length
    const an = flattenItems(api.map).length
    return { map: an >= pn ? api.map : pages.map, sha: api.sha }
  }
  if (api) return api
  if (pages) return pages

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
  let useSha = sha
  try {
    if (!useSha) {
      const meta = await fetch(`${API}?ts=${Date.now()}`, {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
        },
      })
      if (meta.ok) {
        const body = (await meta.json()) as { sha?: string }
        useSha = body.sha ?? ''
      }
    }
    const payload = serializeSchedule(map)
    const res = await fetch(API, {
      method: 'PUT',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: 'Update public schedule',
        content: encodeBase64(payload),
        branch: 'main',
        ...(useSha ? { sha: useSha } : {}),
      }),
    })
    if (res.status === 409) throw new Error('冲突')
    if (res.status === 401 || res.status === 403) throw new Error('口令无效或权限不足')
    if (!res.ok) throw new Error('同步失败')
    const body = (await res.json()) as { content?: { sha?: string } }
    return body.content?.sha ?? sha
  } catch (e) {
    if (e instanceof Error && (e.message === '冲突' || e.message.includes('口令') || e.message === '同步失败')) {
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
