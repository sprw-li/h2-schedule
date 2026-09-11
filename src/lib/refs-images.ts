import { getWriteToken, setWriteToken } from './cloud'
import { unlockFromPublic } from './unlock'

export type RefKind = 'timetable' | 'calendar'

const LOCAL_KEY = 'h2-schedule.refs.v1'
const OWNER = 'sprw-li'
const REPO = 'h2-schedule'
const API = `https://api.github.com/repos/${OWNER}/${REPO}/contents`

type LocalPack = Partial<Record<RefKind, string>>

function remotePath(kind: RefKind) {
  return `docs/refs/${kind}.jpg`
}

function readLocal(): LocalPack {
  try {
    const raw = localStorage.getItem(LOCAL_KEY)
    if (!raw) return {}
    return JSON.parse(raw) as LocalPack
  } catch {
    return {}
  }
}

function writeLocal(pack: LocalPack) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(pack))
}

export function getLocalRef(kind: RefKind) {
  return readLocal()[kind] || ''
}

export function setLocalRef(kind: RefKind, dataUrl: string) {
  const pack = readLocal()
  pack[kind] = dataUrl
  writeLocal(pack)
}

/** 压缩成 JPEG data URL，控制体积便于本机与 GitHub 存储 */
export async function fileToJpegDataUrl(file: File, maxEdge = 1600, quality = 0.82) {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法处理图片')
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()
  const dataUrl = canvas.toDataURL('image/jpeg', quality)
  if (!dataUrl.startsWith('data:image/jpeg')) throw new Error('图片转换失败')
  return dataUrl
}

function dataUrlToRawBase64(dataUrl: string) {
  const i = dataUrl.indexOf(',')
  if (i < 0) throw new Error('图片格式不对')
  return dataUrl.slice(i + 1)
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('读取失败'))
    reader.readAsDataURL(blob)
  })
}

async function fetchGithubFile(path: string, token?: string) {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${API}/${path}?ts=${Date.now()}`, { headers })
  if (res.status === 404) return null
  if (!res.ok) throw new Error('读取图片失败')
  const body = (await res.json()) as {
    content?: string
    sha?: string
    download_url?: string
  }
  if (body.download_url) {
    try {
      const raw = await fetch(
        `${body.download_url}${body.download_url.includes('?') ? '&' : '?'}ts=${Date.now()}`,
      )
      if (raw.ok) {
        const blob = await raw.blob()
        return { dataUrl: await blobToDataUrl(blob), sha: body.sha ?? '' }
      }
    } catch {
      /* fall through */
    }
  }
  if (!body.content) return null
  const b64 = body.content.replace(/\n/g, '')
  return { dataUrl: `data:image/jpeg;base64,${b64}`, sha: body.sha ?? '' }
}

/** 优先远端 → 本机覆盖 → 内置图 */
export async function resolveRefSrc(kind: RefKind, bundled: string) {
  const token = getWriteToken()
  try {
    const remote = await fetchGithubFile(remotePath(kind), token || undefined)
    if (remote?.dataUrl) {
      setLocalRef(kind, remote.dataUrl)
      return remote.dataUrl
    }
  } catch {
    /* ignore */
  }
  return getLocalRef(kind) || bundled
}

export async function uploadRefImage(kind: RefKind, dataUrl: string, phrase: string) {
  const p = phrase.trim()
  if (p) {
    const token = await unlockFromPublic(p)
    setWriteToken(token)
  }
  const writeToken = getWriteToken()
  if (!writeToken) throw new Error('需要口令')

  const path = remotePath(kind)
  let sha = ''
  try {
    const meta = await fetch(`${API}/${path}?ts=${Date.now()}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${writeToken}`,
      },
    })
    if (meta.ok) {
      const body = (await meta.json()) as { sha?: string }
      sha = body.sha ?? ''
    }
  } catch {
    /* create new */
  }

  const res = await fetch(`${API}/${path}`, {
    method: 'PUT',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${writeToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: `Update ${kind} reference image`,
      content: dataUrlToRawBase64(dataUrl),
      branch: 'main',
      ...(sha ? { sha } : {}),
    }),
  })
  if (res.status === 401 || res.status === 403) throw new Error('口令无效或权限不足')
  if (!res.ok) throw new Error('上传失败')
  setLocalRef(kind, dataUrl)
}
