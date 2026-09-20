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

export function getCampusUser() {
  try {
    const v = localStorage.getItem(LS_USER)
    if (v) return v
  } catch {
    /* ignore */
  }
  return String(import.meta.env.VITE_CAMPUS_USER ?? '')
}

export function getCampusPass() {
  try {
    const v = localStorage.getItem(LS_PASS)
    if (v) return v
  } catch {
    /* ignore */
  }
  return String(import.meta.env.VITE_CAMPUS_PASS ?? '')
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

/** 把构建时打进 APK 的 CLab 登录写进本机，输入框直接显示。 */
export function seedCampusLogin() {
  const u = getCampusUser()
  const p = getCampusPass()
  if (u && p) setCampusAccount(u, p)
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
