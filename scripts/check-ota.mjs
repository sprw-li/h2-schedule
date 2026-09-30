/**
 * OTA 本机时间戳不变量：
 * - 写包成功 → localBuiltAt === bundle.builtAt
 * - 写一半失败 → 不留下「已是最新」假象（无孤儿 APPLIED，旧包可恢复）
 * - 孤儿 APPLIED（无 HTML）→ 清理后回落到页面/壳时间
 * - APPLIED 与 bundle 漂移 → 以 bundle 为准
 */
import { webcrypto } from 'node:crypto'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

/** 最小 localStorage mock；可选配额与截断，模拟 Android WebView 坏行为 */
function makeStorage(opts = {}) {
  const { quota = Infinity, truncateOnWrite = false, failKeys = new Set() } = opts
  /** @type {Map<string, string>} */
  const map = new Map()
  let used = 0

  const api = {
    getItem(k) {
      return map.has(k) ? map.get(k) : null
    },
    setItem(k, v) {
      const s = String(v)
      if (failKeys.has(k)) {
        const err = new Error('QuotaExceededError')
        err.name = 'QuotaExceededError'
        throw err
      }
      const prev = map.has(k) ? map.get(k).length : 0
      const nextUsed = used - prev + s.length
      if (nextUsed > quota) {
        const err = new Error('QuotaExceededError')
        err.name = 'QuotaExceededError'
        throw err
      }
      const written = truncateOnWrite && s.length > 80 ? s.slice(0, 80) : s
      // 截断写入仍占「声称」长度以外的实际长度，用于测 roundtrip
      used = used - prev + written.length
      map.set(k, written)
    },
    removeItem(k) {
      if (!map.has(k)) return
      used -= map.get(k).length
      map.delete(k)
    },
    clear() {
      map.clear()
      used = 0
    },
    get length() {
      return map.size
    },
    key(i) {
      return [...map.keys()][i] ?? null
    },
    _dump() {
      return Object.fromEntries(map)
    },
    _used() {
      return used
    },
  }
  return api
}

function installGlobals(storage) {
  globalThis.localStorage = storage
  if (!globalThis.crypto?.subtle) {
    Object.defineProperty(globalThis, 'crypto', {
      value: webcrypto,
      configurable: true,
    })
  }
  if (typeof globalThis.window === 'undefined') {
    globalThis.window = globalThis
  }
  if (!globalThis.document) {
    globalThis.document = {
      querySelector() {
        return null
      },
    }
  }
}

const STORAGE_KEY = 'h2.ota.bundle.v2'
const META_KEY = 'h2.ota.meta.v2'
const APPLIED_KEY = 'h2.ota.applied-built-at'

function sampleBundle(builtAt, htmlExtra = '') {
  const html = `<!doctype html><html><body><div id="root"></div>${htmlExtra}</body></html>`.padEnd(
    1200,
    'x',
  )
  return {
    builtAt,
    sha256: 'a'.repeat(64),
    html,
    verified: true,
    appliedAt: '2026-09-30T00:00:00.000Z',
  }
}

async function main() {
  installGlobals(makeStorage())
  // 动态导入，确保先装好 localStorage
  const ota = await import('../src/lib/ota.ts')

  // --- 1) 成功写入：本机时间戳立即等于新包 builtAt ---
  {
    const store = makeStorage()
    installGlobals(store)
    const t1 = '2026-09-28T05:00:00.000Z'
    const t2 = '2026-09-30T08:00:00.000Z'
    ota.saveBundle(sampleBundle(t1))
    assert(ota.localBuiltAt() === t1, `after first save local=${ota.localBuiltAt()} want ${t1}`)
    ota.saveBundle(sampleBundle(t2, 'v2'))
    assert(ota.localBuiltAt() === t2, `after second save local=${ota.localBuiltAt()} want ${t2}`)
    assert(store.getItem(APPLIED_KEY) === t2, 'APPLIED must match new builtAt')
    const meta = JSON.parse(store.getItem(META_KEY))
    assert(meta.builtAt === t2, 'META.builtAt must match')
    assert(ota.loadLocalBundle()?.builtAt === t2, 'bundle.builtAt must be t2')
  }

  // --- 2) APPLIED 漂移（偏旧）：读路径以 bundle 为准并回写 ---
  {
    const store = makeStorage()
    installGlobals(store)
    const tNew = '2026-09-30T09:00:00.000Z'
    const tOld = '2026-09-20T01:00:00.000Z'
    ota.saveBundle(sampleBundle(tNew))
    store.setItem(APPLIED_KEY, tOld) // 人为写脏
    assert(ota.localBuiltAt() === tNew, 'stale APPLIED must not override bundle')
    assert(store.getItem(APPLIED_KEY) === tNew, 'reconcile must rewrite APPLIED')
  }

  // --- 3) APPLIED 漂移（偏新，无对应新 HTML）：以 bundle 为准，避免「已是最新」假象 ---
  {
    const store = makeStorage()
    installGlobals(store)
    const tBundle = '2026-09-28T05:00:00.000Z'
    const tLie = '2026-09-30T12:00:00.000Z'
    ota.saveBundle(sampleBundle(tBundle))
    store.setItem(APPLIED_KEY, tLie)
    const local = ota.localBuiltAt()
    assert(local === tBundle, `lying APPLIED must not win; got ${local}`)
    assert(ota.isNewer(tLie, local), 'remote newer than real bundle must still show hasUpdate')
  }

  // --- 4) 孤儿 APPLIED（无 HTML）→ 清理，回落到壳占位 ---
  {
    const store = makeStorage()
    installGlobals(store)
    store.setItem(APPLIED_KEY, '2026-09-30T12:00:00.000Z')
    store.setItem(META_KEY, JSON.stringify({ builtAt: '2026-09-30T12:00:00.000Z', sha256: 'b'.repeat(64) }))
    const local = ota.localBuiltAt()
    assert(local === '本机打包', `orphan must fall back; got ${local}`)
    assert(store.getItem(APPLIED_KEY) == null, 'orphan APPLIED cleared')
    assert(store.getItem(META_KEY) == null, 'orphan META cleared')
  }

  // --- 5) META 写入失败：整组回滚，不留新 APPLIED / 不丢可恢复旧包 ---
  {
    const store = makeStorage()
    installGlobals(store)
    const t1 = '2026-09-28T05:00:00.000Z'
    const t2 = '2026-09-30T10:00:00.000Z'
    ota.saveBundle(sampleBundle(t1))
    const base = makeStorage()
    for (const k of [STORAGE_KEY, APPLIED_KEY, META_KEY]) {
      const v = store.getItem(k)
      if (v != null) base.setItem(k, v)
    }
    const failStore = {
      getItem: (k) => base.getItem(k),
      removeItem: (k) => base.removeItem(k),
      clear: () => base.clear(),
      setItem(k, v) {
        if (k === META_KEY) {
          try {
            const parsed = JSON.parse(String(v))
            if (parsed?.builtAt === t2) {
              const err = new Error('QuotaExceededError')
              err.name = 'QuotaExceededError'
              throw err
            }
          } catch (e) {
            if (e && e.name === 'QuotaExceededError') throw e
          }
        }
        base.setItem(k, v)
      },
    }
    installGlobals(failStore)
    let threw = false
    try {
      ota.saveBundle(sampleBundle(t2, 'fail-meta'))
    } catch {
      threw = true
    }
    assert(threw, 'meta failure must throw')
    assert(ota.loadLocalBundle()?.builtAt === t1, 'old bundle restored')
    assert(base.getItem(APPLIED_KEY) === t1, 'APPLIED restored to old')
    assert(ota.localBuiltAt() === t1, 'local stays on old real package')
    assert(ota.isNewer(t2, ota.localBuiltAt()), 'still sees remote as newer — no fake latest')
  }

  // --- 6) HTML 写入配额失败：回滚，无孤儿 ---
  {
    const store = makeStorage({ quota: 500 })
    installGlobals(store)
    let threw = false
    try {
      ota.saveBundle(sampleBundle('2026-09-30T11:00:00.000Z'))
    } catch {
      threw = true
    }
    assert(threw, 'quota fail must throw')
    assert(ota.loadLocalBundle() == null, 'no partial HTML')
    assert(store.getItem(APPLIED_KEY) == null, 'no orphan APPLIED after html fail')
    assert(ota.localBuiltAt() === '本机打包', 'local not faked as updated')
  }

  // --- 7) 静默截断：roundtrip 必须失败并回滚 ---
  {
    const store = makeStorage()
    installGlobals(store)
    const t1 = '2026-09-28T05:00:00.000Z'
    const t2 = '2026-09-30T13:00:00.000Z'
    ota.saveBundle(sampleBundle(t1))
    const base = makeStorage()
    base.setItem(STORAGE_KEY, store.getItem(STORAGE_KEY))
    base.setItem(APPLIED_KEY, t1)
    base.setItem(META_KEY, store.getItem(META_KEY))
    const proxied = {
      getItem: (k) => base.getItem(k),
      removeItem: (k) => base.removeItem(k),
      clear: () => base.clear(),
      setItem(k, v) {
        const s = String(v)
        // 只截断「新包」写入；回滚旧包必须完整写回
        if (k === STORAGE_KEY && s.includes('"builtAt":"' + t2 + '"')) {
          base.setItem(k, s.slice(0, 120))
          return
        }
        base.setItem(k, s)
      },
    }
    installGlobals(proxied)
    let threw = false
    try {
      ota.saveBundle(sampleBundle(t2, 'truncated'))
    } catch {
      threw = true
    }
    assert(threw, 'silent truncate must fail roundtrip')
    assert(ota.loadLocalBundle()?.builtAt === t1, 'restore old after truncate')
    assert(ota.localBuiltAt() === t1, 'local unchanged after truncate fail')
  }

  console.log('check-ota: ok')
}

main().catch((e) => {
  console.error('check-ota FAILED:', e.message || e)
  process.exit(1)
})
