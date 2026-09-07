import { flattenItems, replaceSchedule } from './backup'
import type { ScheduleMap } from '../types'

const OWNER = 'sprw-li'
const REPO = 'h2-schedule'
const PATH = 'docs/schedule.json'
const TOKEN_KEY = 'h2-schedule.write-token'
const API = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${PATH}`

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

const BUNDLED_JSON = `${import.meta.env.BASE_URL}schedule.json`

function parseContents(body: { content?: string; sha?: string }) {
  if (!body.content) return null
  const parsed = JSON.parse(decodeBase64(body.content.replace(/\n/g, ''))) as { items?: unknown }
  const items = Array.isArray(parsed.items) ? parsed.items : []
  return {
    map: replaceSchedule(items as Parameters<typeof replaceSchedule>[0]),
    sha: body.sha ?? '',
  }
}

export async function pullCloud(): Promise<{ map: ScheduleMap; sha: string } | null> {
  const token = getWriteToken()
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' }
  if (token) headers.Authorization = `Bearer ${token}`
  try {
    const res = await fetch(`${API}?ts=${Date.now()}`, { headers })
    if (res.ok) {
      const body = (await res.json()) as { content?: string; sha?: string }
      const parsed = parseContents(body)
      if (parsed) return parsed
    }
  } catch {
    /* fall through to bundled copy */
  }
  const res = await fetch(`${BUNDLED_JSON}?ts=${Date.now()}`)
  if (res.status === 404) return { map: {}, sha: '' }
  if (!res.ok) throw new Error('读取公开日程失败')
  const parsed = (await res.json()) as { items?: unknown }
  const items = Array.isArray(parsed.items) ? parsed.items : []
  return {
    map: replaceSchedule(items as Parameters<typeof replaceSchedule>[0]),
    sha: '',
  }
}

export async function pushCloud(map: ScheduleMap, sha: string) {
  const token = getWriteToken()
  if (!token) throw new Error('需要写入令牌才能同步到公开仓库')
  let useSha = sha
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
  const payload = JSON.stringify({ items: flattenItems(map) }, null, 2)
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
  if (res.status === 401 || res.status === 403) throw new Error('写入令牌无效或权限不足')
  if (!res.ok) throw new Error('写入公开日程失败')
  const body = (await res.json()) as { content?: { sha?: string } }
  return body.content?.sha ?? sha
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
