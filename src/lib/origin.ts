const LS = 'h2-schedule.campus-origin'
const LS_USER = 'h2-schedule.campus-user'
const LS_PASS = 'h2-schedule.campus-pass'
const LS_SOURCE = 'h2-schedule.sync-source'

export type SyncSource = 'clab' | 'github'

function trimOrigin(raw: string) {
  return raw.trim().replace(/\/$/, '')
}

/** 校服务器根地址。localStorage 优先，其次构建时的 VITE_CAMPUS_ORIGIN。空 = 仍走 GitHub。 */
export function getCampusOrigin() {
  try {
    const v = localStorage.getItem(LS)
    if (v) return trimOrigin(v)
  } catch {
    /* ignore */
  }
  const env = String(import.meta.env.VITE_CAMPUS_ORIGIN ?? '')
  if (env) return trimOrigin(env)
  try {
    const o = trimOrigin(window.location.origin)
    if (/^https?:\/\/10\.129\.\d+\.\d+(?::\d+)?$/i.test(o)) return o
  } catch {
    /* ignore */
  }
  return ''
}

/** 校内账密只来自本机输入（localStorage）。绝不读构建时环境变量，否则会随公开产物外泄。 */
export function getCampusUser() {
  try {
    return localStorage.getItem(LS_USER) ?? ''
  } catch {
    return ''
  }
}

export function getCampusPass() {
  try {
    return localStorage.getItem(LS_PASS) ?? ''
  } catch {
    return ''
  }
}

export function getSyncSource(): SyncSource {
  try {
    const v = localStorage.getItem(LS_SOURCE)
    if (v === 'clab' || v === 'github') return v
  } catch {
    /* ignore */
  }
  return String(import.meta.env.VITE_CAMPUS_ORIGIN ?? '') ? 'clab' : 'github'
}

export function setSyncSource(next: SyncSource) {
  try {
    localStorage.setItem(LS_SOURCE, next)
  } catch {
    /* ignore */
  }
}

/** 只把构建时打进 APK 的 CLab 根地址（非秘密）写进本机；账密一律等用户在本机输入。 */
export function seedCampusLogin() {
  const o = getCampusOrigin()
  if (o) setCampusOrigin(o)
}

export function setCampusAccount(user: string, pass: string) {
  try {
    const u = user.trim()
    const p = pass.trim()
    if (!u) localStorage.removeItem(LS_USER)
    else localStorage.setItem(LS_USER, u)
    if (!p) localStorage.removeItem(LS_PASS)
    else localStorage.setItem(LS_PASS, p)
  } catch {
    /* ignore */
  }
}

/** 校内读写用 Basic；未填账密则不带 Authorization。 */
export function campusAuthHeaders(): Record<string, string> {
  const u = getCampusUser()
  const p = getCampusPass()
  if (!u || !p) return {}
  const raw = `${u}:${p}`
  const bytes = new TextEncoder().encode(raw)
  let bin = ''
  bytes.forEach((b) => {
    bin += String.fromCharCode(b)
  })
  return { Authorization: `Basic ${btoa(bin)}` }
}

/** 顶栏选了 CLab 才把校内当即时入口。GitHub 入口仍会尽量镜像一份到 CLab。 */
export function campusIsLive() {
  return getSyncSource() === 'clab' && Boolean(getCampusOrigin())
}

export function setCampusOrigin(url: string) {
  const t = trimOrigin(url)
  try {
    if (!t) localStorage.removeItem(LS)
    else localStorage.setItem(LS, t)
  } catch {
    /* ignore */
  }
}

export function campusUrl(repoOrSitePath: string) {
  const o = getCampusOrigin()
  if (!o) return ''
  const p = repoOrSitePath.replace(/^docs\//, '').replace(/^\//, '')
  return `${o}/${p}`
}
