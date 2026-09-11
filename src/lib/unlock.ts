import bundledUnlock from '../../public/unlock.json'

const te = new TextEncoder()
const td = new TextDecoder()

export type UnlockPack = {
  h2: 1
  kind: 'write-unlock'
  salt: string
  iv: string
  data: string
}

export function isUnlockPack(raw: string) {
  try {
    const j = JSON.parse(raw) as Partial<UnlockPack>
    return j?.h2 === 1 && j.kind === 'write-unlock' && !!j.salt && !!j.iv && !!j.data
  } catch {
    return false
  }
}

const ITERATIONS = 60000

export async function encryptWriteSecret(token: string, phrase: string) {
  const key = await deriveKey(phrase)
  const iv = randomBytes(12)
  const buf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key.cryptoKey,
    te.encode(JSON.stringify({ token })),
  )
  const pack: UnlockPack = {
    h2: 1,
    kind: 'write-unlock',
    salt: b64(key.salt),
    iv: b64(iv),
    data: b64(new Uint8Array(buf)),
  }
  return JSON.stringify(pack, null, 2) + '\n'
}

export async function decryptWriteSecret(raw: string, phrase: string) {
  if (!isUnlockPack(raw)) throw new Error('口令无效')
  const pack = JSON.parse(raw) as UnlockPack
  const key = await deriveKey(phrase, fromB64(pack.salt))
  try {
    const buf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64(pack.iv) },
      key.cryptoKey,
      fromB64(pack.data),
    )
    const parsed = JSON.parse(td.decode(buf)) as { token?: string }
    const token = parsed.token?.trim()
    if (!token) throw new Error('empty')
    return token
  } catch {
    throw new Error('口令不对')
  }
}

export function normalizePhrase(phrase: string) {
  return phrase.trim().toUpperCase().replace(/\s+/g, '')
}

/**
 * 口令包优先取：
 * 1) OTA/页面里嵌入的 #h2-unlock-pack（改口令后靠更新即可）
 * 2) 构建时打进 JS 的 public/unlock.json
 * 不依赖私有仓 GitHub API（无 Token 会 403，手机否则会落到 APK 旧文件）
 */
function loadUnlockRaw() {
  try {
    const fromDom = document.getElementById('h2-unlock-pack')?.textContent?.trim()
    if (fromDom && isUnlockPack(fromDom)) return fromDom
  } catch {
    /* ignore */
  }
  return JSON.stringify(bundledUnlock)
}

export async function unlockFromPublic(phrase: string) {
  return decryptWriteSecret(loadUnlockRaw(), normalizePhrase(phrase))
}

async function deriveKey(password: string, salt?: Uint8Array<ArrayBuffer>) {
  const used = salt ?? randomBytes(16)
  const base = await crypto.subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveKey'])
  const cryptoKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: used, iterations: ITERATIONS, hash: 'SHA-256' },
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
