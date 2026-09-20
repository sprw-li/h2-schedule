const LS = 'h2-schedule.campus-origin'

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
  return env ? trimOrigin(env) : ''
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
