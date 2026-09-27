/**
 * Read/write h2-data (private op-log authority) via GitHub Contents API.
 * Never uses raw.githubusercontent.com for authority (CDN staleness).
 */
import type { ScheduleMap } from '../../types'
import { replaceSchedule } from '../backup'
import { getWriteToken } from '../cloud'
import { GH_OWNER, netErr } from '../net'
import { parseScheduleJsonText } from '../schedule'
import type { Op, OpQueueState } from './types'
import { currentMonthKey, loadQueue, saveQueue } from './queue'

export const DATA_REPO = 'h2-data'

function dataApi(path: string) {
  return `https://api.github.com/repos/${GH_OWNER}/${DATA_REPO}/contents/${path}`
}

function dataTrees() {
  return `https://api.github.com/repos/${GH_OWNER}/${DATA_REPO}/git/trees/main?recursive=1`
}

function authHeaders(): Record<string, string> | null {
  const token = getWriteToken()
  if (!token) return null
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
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

function parseJsonl(text: string): Op[] {
  const out: Op[] = []
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    if (!t) continue
    try {
      out.push(JSON.parse(t) as Op)
    } catch {
      /* skip */
    }
  }
  return out
}

export async function pullSnapshot(): Promise<{ map: ScheduleMap; rev: number; status: unknown } | null> {
  const headers = authHeaders()
  if (!headers) return null
  try {
    const [schedRes, statusRes] = await Promise.all([
      fetch(`${dataApi('snapshot/schedule.json')}?ts=${Date.now()}`, { headers }),
      fetch(`${dataApi('snapshot/status.json')}?ts=${Date.now()}`, { headers }),
    ])
    if (!schedRes.ok) return null
    const schedBody = (await schedRes.json()) as { content?: string }
    if (!schedBody.content) return null
    const text = decodeBase64(schedBody.content.replace(/\n/g, ''))
    const { items } = parseScheduleJsonText(text)
    const map = replaceSchedule(items as never)
    let rev = 0
    let status: unknown = null
    if (statusRes.ok) {
      const stBody = (await statusRes.json()) as { content?: string }
      if (stBody.content) {
        status = JSON.parse(decodeBase64(stBody.content.replace(/\n/g, '')))
        rev = Number((status as { rev?: number }).rev) || 0
      }
    }
    return { map, rev, status }
  } catch (e) {
    throw new Error(netErr(e, '拉快照失败'))
  }
}

/** List ops/** paths from git tree (with optional ETag). */
export async function listOpFiles(etag?: string): Promise<{ paths: string[]; etag: string; notModified: boolean }> {
  const headers = authHeaders()
  if (!headers) return { paths: [], etag: '', notModified: false }
  const h = { ...headers }
  if (etag) h['If-None-Match'] = etag
  const res = await fetch(dataTrees(), { headers: h })
  if (res.status === 304) return { paths: [], etag: etag || '', notModified: true }
  if (!res.ok) throw new Error(`列 ops 失败 (${res.status})`)
  const body = (await res.json()) as { tree?: Array<{ path?: string; type?: string }> }
  const paths = (body.tree || [])
    .filter((t) => t.type === 'blob' && t.path?.startsWith('ops/') && t.path.endsWith('.jsonl'))
    .map((t) => t.path!)
  return { paths, etag: res.headers.get('etag') || '', notModified: false }
}

export async function pullOpFile(path: string, etag?: string): Promise<{ ops: Op[]; etag: string; notModified: boolean }> {
  const headers = authHeaders()
  if (!headers) return { ops: [], etag: '', notModified: false }
  const h = { ...headers }
  if (etag) h['If-None-Match'] = etag
  const res = await fetch(`${dataApi(path)}?ts=${Date.now()}`, { headers: h })
  if (res.status === 304) return { ops: [], etag: etag || '', notModified: true }
  if (res.status === 404) return { ops: [], etag: '', notModified: false }
  if (!res.ok) throw new Error(`读 ${path} 失败 (${res.status})`)
  const body = (await res.json()) as { content?: string; sha?: string }
  const text = body.content ? decodeBase64(body.content.replace(/\n/g, '')) : ''
  return { ops: parseJsonl(text), etag: res.headers.get('etag') || body.sha || '', notModified: false }
}

export async function pullAllOps(): Promise<Op[]> {
  const { paths } = await listOpFiles()
  const all: Op[] = []
  for (const p of paths) {
    const { ops } = await pullOpFile(p)
    all.push(...ops)
  }
  return all
}

/**
 * Append queue ops to this device's monthly jsonl via Contents API.
 * Returns flushed opIds on success.
 */
export async function flushOps(): Promise<{ flushed: string[]; sha: string }> {
  const headers = authHeaders()
  if (!headers) throw new Error('需要口令才能同步到数据仓')

  const state = loadQueue()
  if (state.queue.length === 0) return { flushed: [], sha: '' }

  const month = currentMonthKey()
  const path = `ops/${state.deviceId}/${month}.jsonl`
  const api = dataApi(path)
  const getHeaders = { ...headers }

  let oldText = ''
  let sha = state.fileSha[month] || ''

  const meta = await fetch(`${api}?ts=${Date.now()}`, { headers: getHeaders })
  if (meta.ok) {
    const body = (await meta.json()) as { content?: string; sha?: string }
    if (body.content) oldText = decodeBase64(body.content.replace(/\n/g, ''))
    if (body.sha) sha = body.sha
  } else if (meta.status !== 404) {
    throw new Error(`读本机 op 文件失败 (${meta.status})`)
  }

  // Ensure trailing newline before append
  if (oldText && !oldText.endsWith('\n')) oldText += '\n'
  const lines = state.queue.map((op) => JSON.stringify(op)).join('\n') + '\n'
  const newText = oldText + lines
  const flushed = state.queue.map((op) => op.opId)

  async function put(useSha: string) {
    return fetch(api, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `ops: ${state.deviceId} +${flushed.length}`,
        content: encodeBase64(newText),
        branch: 'main',
        ...(useSha ? { sha: useSha } : {}),
      }),
    })
  }

  let res = await put(sha)
  if (res.status === 409) {
    const again = await fetch(`${api}?ts=${Date.now()}`, { headers: getHeaders })
    if (!again.ok) throw new Error('冲突')
    const body = (await again.json()) as { content?: string; sha?: string }
    // Re-append onto latest (own file — safe)
    let latest = body.content ? decodeBase64(body.content.replace(/\n/g, '')) : ''
    if (latest && !latest.endsWith('\n')) latest += '\n'
    const merged = latest + lines
    res = await fetch(api, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `ops: ${state.deviceId} +${flushed.length} (retry)`,
        content: encodeBase64(merged),
        branch: 'main',
        sha: body.sha,
      }),
    })
  }

  if (res.status === 401 || res.status === 403) throw new Error('口令无效或权限不足（需 h2-data Contents 写权限）')
  if (!res.ok) throw new Error(netErr(new Error(`同步失败 (${res.status})`), '同步失败'))

  const out = (await res.json()) as { content?: { sha?: string } }
  const nextSha = out.content?.sha || sha
  const next: OpQueueState = loadQueue()
  next.queue = next.queue.filter((op) => !flushed.includes(op.opId))
  next.fileSha = { ...next.fileSha, [month]: nextSha }
  saveQueue(next)
  return { flushed, sha: nextSha }
}

/** Narrow guard: refuse flushing a batch that deletes >50% of known items without confirm. */
export function guardMassDelete(map: ScheduleMap, ops: Op[], confirmed: boolean) {
  const n = Object.values(map).flat().length
  const deletes = ops.filter((o) => o.type === 'delete').length
  if (n >= 10 && deletes > n * 0.5 && !confirmed) {
    throw new Error('本批删除超过一半条目，已拦截（确认后再同步）')
  }
}
