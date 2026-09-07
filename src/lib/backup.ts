import type { ScheduleItem, ScheduleMap } from '../types'

const te = new TextEncoder()
const td = new TextDecoder()

export type EncryptedBackup = {
  h2: 1
  kind: 'schedule-backup'
  salt: string
  iv: string
  data: string
}

export function flattenItems(map: ScheduleMap): ScheduleItem[] {
  return Object.values(map)
    .flat()
    .sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date)
      const ta = a.time ?? ''
      const tb = b.time ?? ''
      if (ta !== tb) return ta.localeCompare(tb)
      return a.title.localeCompare(b.title, 'zh')
    })
}

export function replaceSchedule(items: ScheduleItem[]): ScheduleMap {
  const map: ScheduleMap = {}
  for (const item of items) {
    if (!item.date || !item.title) continue
    const list = map[item.date] ?? []
    list.push(item)
    map[item.date] = list
  }
  return map
}

export function isEncryptedBackup(raw: string): boolean {
  try {
    const j = JSON.parse(raw) as Partial<EncryptedBackup>
    return j?.h2 === 1 && j.kind === 'schedule-backup' && !!j.salt && !!j.iv && !!j.data
  } catch {
    return false
  }
}

export async function fingerprint(map: ScheduleMap) {
  const canon = flattenItems(map).map((i) =>
    [i.date, i.time ?? '', i.kind, i.done ? '1' : '0', i.title].join('\t'),
  )
  const bytes = te.encode(canon.join('\n'))
  if (globalThis.crypto?.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', bytes)
    return hex(new Uint8Array(buf)).slice(0, 8)
  }
  let h = 2166136261
  for (const b of bytes) {
    h ^= b
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

export async function encryptBackup(map: ScheduleMap, password: string) {
  const key = await deriveKey(password, undefined)
  const iv = randomBytes(12)
  const plain = te.encode(JSON.stringify({ items: flattenItems(map) }))
  const buf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key.cryptoKey, plain)
  const pack: EncryptedBackup = {
    h2: 1,
    kind: 'schedule-backup',
    salt: b64(key.salt),
    iv: b64(iv),
    data: b64(new Uint8Array(buf)),
  }
  return JSON.stringify(pack)
}

export async function decryptBackup(raw: string, password: string): Promise<ScheduleItem[]> {
  const pack = JSON.parse(raw) as EncryptedBackup
  if (!isEncryptedBackup(raw)) throw new Error('不是加密备份')
  const key = await deriveKey(password, fromB64(pack.salt))
  const iv = fromB64(pack.iv)
  const data = fromB64(pack.data)
  try {
    const buf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key.cryptoKey, data)
    const parsed = JSON.parse(td.decode(buf)) as { items?: ScheduleItem[] }
    if (!Array.isArray(parsed.items)) throw new Error('备份损坏')
    return parsed.items
  } catch {
    throw new Error('密码不对，或文件已损坏')
  }
}

async function deriveKey(password: string, salt?: Uint8Array<ArrayBuffer>) {
  const used = salt ?? randomBytes(16)
  const base = await crypto.subtle.importKey('raw', te.encode(password), 'PBKDF2', false, [
    'deriveKey',
  ])
  const cryptoKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: used, iterations: 210000, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
  return { cryptoKey, salt: used }
}

function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const buf = new Uint8Array(n)
  crypto.getRandomValues(buf)
  return buf
}

function hex(bytes: Uint8Array) {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function b64(bytes: Uint8Array) {
  let s = ''
  bytes.forEach((b) => {
    s += String.fromCharCode(b)
  })
  return btoa(s)
}

function fromB64(value: string): Uint8Array<ArrayBuffer> {
  const bin = atob(value)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
