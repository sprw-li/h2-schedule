import { useEffect, useState } from 'react'
import { getWriteToken, setWriteToken } from '../lib/cloud'
import {
  applyUpdate,
  checkForUpdate,
  clearLocalBundle,
  localBuiltAt,
  type OtaManifest,
} from '../lib/ota'
import { resetSchedule } from '../lib/storage'
import { unlockFromPublic } from '../lib/unlock'

function fmt(iso: string) {
  if (!iso || iso === '本机打包') return '当前安装包'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  // 固定按北京时间显示，避免看起来总像同一个钟点
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d)
  const get = (t: string) => parts.find((p) => p.type === t)?.value || ''
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`
}

export function UpdateBar() {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [local, setLocal] = useState(() => localBuiltAt())
  const [remote, setRemote] = useState<OtaManifest | null>(null)
  const [hasUpdate, setHasUpdate] = useState(false)
  const [note, setNote] = useState('')
  const [phrase, setPhrase] = useState('')
  const [needPhrase, setNeedPhrase] = useState(() => !getWriteToken())

  async function refresh(quiet = false) {
    setBusy(true)
    setErr('')
    if (!quiet) setNote('')
    try {
      // 查更新优先走公开 Pages，可不先填口令；写回远端仍要口令
      const r = await checkForUpdate()
      setLocal(r.localBuiltAt)
      setRemote(r.manifest)
      setHasUpdate(r.hasUpdate)
      if (!quiet) {
        setNote(r.hasUpdate ? '发现新版本，可以更新' : '已是最新')
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '暂时查不到更新'
      setErr(msg)
      if (msg.includes('口令')) setNeedPhrase(true)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void refresh(true)
  }, [])

  async function onUnlockThen(action: 'check' | 'apply') {
    const p = phrase.trim()
    if (!p) {
      setErr('还没填口令')
      return
    }
    setBusy(true)
    setErr('')
    setNote('正在验证口令…')
    try {
      const token = await unlockFromPublic(p)
      setWriteToken(token)
      setPhrase('')
      setNeedPhrase(false)
      if (action === 'apply') {
        setNote('正在下载…')
        const bundle = await applyUpdate()
        setLocal(bundle.builtAt)
        setHasUpdate(false)
        setNote('下载完成，即将刷新')
        window.setTimeout(() => window.location.reload(), 400)
        return
      }
      await refresh(false)
    } catch (e: unknown) {
      setBusy(false)
      setErr(e instanceof Error ? e.message : '失败')
      setNote('')
    }
  }

  async function onApply() {
    setBusy(true)
    setErr('')
    setNote('正在下载…')
    try {
      // 读更新包可走 Pages，无需口令；仅当 Pages 失败才提示口令走 API
      const bundle = await applyUpdate()
      setLocal(bundle.builtAt)
      setHasUpdate(false)
      setNote('下载完成，即将刷新')
      window.setTimeout(() => window.location.reload(), 400)
    } catch (e: unknown) {
      setBusy(false)
      const msg = e instanceof Error ? e.message : '更新失败'
      setErr(msg)
      setNote('')
      if (msg.includes('口令')) setNeedPhrase(true)
    }
  }

  return (
    <div className="update-wrap">
      <button
        type="button"
        className={`ghost update-chip${hasUpdate ? ' hot' : ''}`}
        aria-expanded={open}
        onClick={() => {
          const next = !open
          setOpen(next)
          if (next) void refresh(true)
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          if (!busy && hasUpdate) void onApply()
        }}
      >
        {hasUpdate ? '有更新' : '更新'}
      </button>
      {open ? (
        <div className="update-sheet" role="dialog" aria-label="更新">
          <div className="update-card-head">
            <strong>更新</strong>
            <button type="button" className="ghost" onClick={() => setOpen(false)}>
              收起
            </button>
          </div>
          <p>
            <span className="mute">本机</span> {fmt(local)}
          </p>
          <p>
            <span className="mute">最新</span> {remote ? fmt(remote.builtAt) : '—'}
          </p>
          {needPhrase ? (
            <div className="update-phrase">
              <label htmlFor="ota-phrase">口令</label>
              <input
                id="ota-phrase"
                type="password"
                autoComplete="current-password"
                value={phrase}
                disabled={busy}
                onChange={(e) => setPhrase(e.target.value)}
              />
            </div>
          ) : null}
          {note ? <p className="update-note">{note}</p> : null}
          {err ? <p className="unlock-error">{err}</p> : null}
          <div className="update-actions">
            {needPhrase ? (
              <>
                <button type="button" className="ghost" disabled={busy} onClick={() => void onUnlockThen('check')}>
                  {busy ? '…' : '验证并查询'}
                </button>
                <button type="button" className="solid" disabled={busy} onClick={() => void onUnlockThen('apply')}>
                  验证并更新
                </button>
              </>
            ) : (
              <>
                <button type="button" className="ghost" disabled={busy} onClick={() => void refresh(false)}>
                  {busy ? '…' : '再查一次'}
                </button>
                <button type="button" className="solid" disabled={busy || !hasUpdate} onClick={() => void onApply()}>
                  立即更新
                </button>
              </>
            )}
            <button
              type="button"
              className="ghost"
              disabled={busy}
              onClick={() => {
                clearLocalBundle()
                resetSchedule()
                setLocal(localBuiltAt())
                setHasUpdate(!!remote && remote.builtAt !== localBuiltAt())
                setNote('已清空本机缓存，刷新后从云端重载')
              }}
            >
              清空本机缓存
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
