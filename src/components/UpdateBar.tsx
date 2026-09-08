import { useEffect, useState } from 'react'
import {
  applyUpdate,
  checkForUpdate,
  clearLocalBundle,
  localBuiltAt,
  type OtaManifest,
} from '../lib/ota'

function fmt(iso: string) {
  if (!iso || iso === '本机打包') return iso || '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function UpdateBar() {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [local, setLocal] = useState(() => localBuiltAt())
  const [remote, setRemote] = useState<OtaManifest | null>(null)
  const [hasUpdate, setHasUpdate] = useState(false)
  const [note, setNote] = useState('')

  async function refresh(quiet = false) {
    setBusy(true)
    setErr('')
    if (!quiet) setNote('')
    try {
      const r = await checkForUpdate()
      setLocal(r.localBuiltAt)
      setRemote(r.manifest)
      setHasUpdate(r.hasUpdate)
      if (!quiet) {
        setNote(r.hasUpdate ? '有新界面包，可联网装配' : '已是清单上的最新包')
      }
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '检查更新失败')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void refresh(true)
  }, [])

  async function onApply() {
    setBusy(true)
    setErr('')
    setNote('正在下载并校验…')
    try {
      const bundle = await applyUpdate()
      setLocal(bundle.builtAt)
      setHasUpdate(false)
      setNote('校验通过，正在装配重启…')
      window.setTimeout(() => window.location.reload(), 400)
    } catch (e: unknown) {
      setBusy(false)
      setErr(e instanceof Error ? e.message : '更新失败')
      setNote('')
    }
  }

  return (
    <div className="update-wrap">
      <button
        type="button"
        className={`ghost update-chip${hasUpdate ? ' hot' : ''}`}
        onClick={() => {
          setOpen((v) => !v)
          if (!open) void refresh(true)
        }}
      >
        {hasUpdate ? '有更新' : '更新'}
      </button>
      {open ? (
        <div className="update-card" role="dialog" aria-label="界面更新">
          <p>
            <span className="mute">本机</span> {fmt(local)}
          </p>
          <p>
            <span className="mute">远端</span> {remote ? fmt(remote.builtAt) : '—'}
          </p>
          {remote ? (
            <p className="update-hash">
              <span className="mute">校验</span> sha256 {remote.sha256.slice(0, 12)}…
            </p>
          ) : null}
          {note ? <p className="update-note">{note}</p> : null}
          {err ? <p className="unlock-error">{err}</p> : null}
          <div className="update-actions">
            <button type="button" className="ghost" disabled={busy} onClick={() => void refresh(false)}>
              {busy ? '…' : '检查'}
            </button>
            <button type="button" className="solid" disabled={busy || !hasUpdate} onClick={() => void onApply()}>
              下载装配
            </button>
            <button
              type="button"
              className="ghost"
              disabled={busy}
              onClick={() => {
                clearLocalBundle()
                setLocal(localBuiltAt())
                setHasUpdate(!!remote && remote.builtAt !== localBuiltAt())
                setNote('已清掉本地装配包，下次将用安装包内界面')
              }}
            >
              还原安装包
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
