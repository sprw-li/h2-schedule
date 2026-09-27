/** 浏览器 TypeError「Failed to fetch」→ 中文；校园网未开代理时很常见 */
export function netErr(err: unknown, fallback = '网络不通，稍后再试') {
  const raw = err instanceof Error ? err.message : String(err || '')
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(raw)) {
    return '连不上服务器（校园网可开系统代理后再试）'
  }
  if (raw && raw !== 'Failed to fetch') return raw
  return fallback
}

export const GH_OWNER = 'sprw-li'
export const GH_REPO = 'h2-schedule'
/** P1 正本：私有数据仓（op 日志）；写令牌只应授权此仓 Contents。 */
export const GH_DATA_REPO = 'h2-data'

/** GitHub Contents API：写回、带 sha。手机 WebView 常被墙。默认代码仓。 */
export function ghApiContents(repoPath: string, repo = GH_REPO) {
  return `https://api.github.com/repos/${GH_OWNER}/${repo}/contents/${repoPath}`
}

export function ghDataApiContents(repoPath: string) {
  return ghApiContents(repoPath, GH_DATA_REPO)
}

/** raw 通常比 Pages 构建新，也不走 api.github.com */
export function ghRaw(repoPath: string) {
  return `https://raw.githubusercontent.com/${GH_OWNER}/${GH_REPO}/main/${repoPath}`
}

/** GitHub Pages（docs/ 为站点根） */
export function ghPages(repoPath: string) {
  return `https://sprw-li.github.io/h2-schedule/${repoPath.replace(/^docs\//, '')}`
}

export async function fetchTextNoThrow(url: string): Promise<string | null> {
  try {
    const res = await fetch(`${url}${url.includes('?') ? '&' : '?'}ts=${Date.now()}`)
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}
