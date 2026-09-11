import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const mcp = JSON.parse(readFileSync(join(process.env.USERPROFILE || '', '.cursor', 'mcp.json'), 'utf8'))
const token = mcp?.mcpServers?.github?.env?.GITHUB_PERSONAL_ACCESS_TOKEN
if (!token || token === 'YOUR_GITHUB_PAT') {
  throw new Error('missing github token in mcp.json')
}

const te = new TextEncoder()
function b64(bytes) {
  let s = ''
  bytes.forEach((b) => {
    s += String.fromCharCode(b)
  })
  return btoa(s)
}

const salt = crypto.getRandomValues(new Uint8Array(16))
const iv = crypto.getRandomValues(new Uint8Array(12))
const phrase = (process.env.UNLOCK_PHRASE || '20080615').trim().toUpperCase().replace(/\s+/g, '')

const base = await crypto.subtle.importKey('raw', te.encode(phrase), 'PBKDF2', false, ['deriveKey'])
const cryptoKey = await crypto.subtle.deriveKey(
  { name: 'PBKDF2', salt, iterations: 60000, hash: 'SHA-256' },
  base,
  { name: 'AES-GCM', length: 256 },
  false,
  ['encrypt'],
)
const buf = await crypto.subtle.encrypt(
  { name: 'AES-GCM', iv },
  cryptoKey,
  te.encode(JSON.stringify({ token })),
)
const pack = {
  h2: 1,
  kind: 'write-unlock',
  salt: b64(salt),
  iv: b64(iv),
  data: b64(new Uint8Array(buf)),
}
writeFileSync(join(root, 'public', 'unlock.json'), `${JSON.stringify(pack, null, 2)}\n`)
console.log(`PHRASE=${phrase}`)
