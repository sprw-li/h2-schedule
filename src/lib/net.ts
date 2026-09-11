/** 浏览器 TypeError「Failed to fetch」→ 中文；校园网未开代理时很常见 */
export function netErr(err: unknown, fallback = '网络不通，稍后再试') {
  const raw = err instanceof Error ? err.message : String(err || '')
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(raw)) {
    return '连不上服务器（校园网可开系统代理后再试）'
  }
  if (raw && raw !== 'Failed to fetch') return raw
  return fallback
}
