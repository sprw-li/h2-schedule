import { useState } from 'react'
import { getCampusOrigin, getCampusPass, getCampusUser, setCampusAccount, setCampusOrigin } from '../lib/origin'
import { clearLocalBundle } from '../lib/ota'
import { resetSchedule } from '../lib/storage'

type ExtraBarProps = {
  onExportCsv: () => void
  onExportIcs: () => void
  onImportFile: () => void
  onPasteImport: () => void
}

export function ExtraBar({
  onExportCsv,
  onExportIcs,
  onImportFile,
  onPasteImport,
}: ExtraBarProps) {
  const [open, setOpen] = useState(false)
  const [campus, setCampus] = useState(() => getCampusOrigin())
  const [campusUser, setCampusUser] = useState(() => getCampusUser())
  const [campusPass, setCampusPass] = useState(() => getCampusPass())

  function persistCampus() {
    setCampusOrigin(campus)
    setCampusAccount(campusUser, campusPass)
  }

  return (
    <div className="extra-wrap">
      <button
        type="button"
        className="ghost extra-chip"
        aria-expanded={open}
        onClick={() => {
          const next = !open
          setOpen(next)
          if (next) {
            setCampus(getCampusOrigin())
            setCampusUser(getCampusUser())
            setCampusPass(getCampusPass())
          }
        }}
      >
        其他功能
      </button>
      {open ? (
        <>
          <button type="button" className="extra-scrim" aria-label="关闭其他功能" onClick={() => setOpen(false)} />
          <div className="update-sheet extra-sheet" role="dialog" aria-label="其他功能">
          <div className="update-card-head">
            <strong>其他功能</strong>
            <button type="button" className="ghost" onClick={() => setOpen(false)}>
              收起
            </button>
          </div>
          <div className="update-actions">
            <button type="button" className="solid csv-btn" onClick={onExportIcs}>
              导出 ICS
            </button>
            <button type="button" className="solid csv-btn" onClick={onExportCsv}>
              导出 CSV
            </button>
            <button type="button" className="solid csv-btn" onClick={onImportFile}>
              导入文件
            </button>
            <button type="button" className="ghost csv-btn" onClick={onPasteImport}>
              粘贴导入
            </button>
          </div>
          <p className="csv-hint">ICS 给系统日历。CSV 给表格互拷。手机导出走分享或复制。</p>
          <div className="update-phrase">
            <label htmlFor="campus-origin">CLab 地址（换机只改这里）</label>
            <input
              id="campus-origin"
              type="url"
              inputMode="url"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="http://10.129.x.x:8765"
              value={campus}
              onChange={(e) => setCampus(e.target.value)}
              onBlur={persistCampus}
            />
            <label htmlFor="campus-user">CLab 用户名（与 SSH 同一组，需手动填写）</label>
            <input
              id="campus-user"
              type="text"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              autoComplete="username"
              value={campusUser}
              onChange={(e) => setCampusUser(e.target.value)}
              onBlur={persistCampus}
            />
            <label htmlFor="campus-pass">CLab 密码（需手动填写）</label>
            <input
              id="campus-pass"
              type="password"
              autoComplete="current-password"
              value={campusPass}
              onChange={(e) => setCampusPass(e.target.value)}
              onBlur={persistCampus}
            />
          </div>
          <p className="mute">顶栏点 CLab 或 GitHub，不会自动切换。任一边写入后会尽量再记一份到另一边。</p>
          <div className="update-actions">
            <button type="button" className="ghost" onClick={persistCampus}>
              保存服务器地址
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                persistCampus()
                clearLocalBundle()
                resetSchedule()
                window.location.reload()
              }}
            >
              清空本机缓存
            </button>
          </div>
        </div>
        </>
      ) : null}
    </div>
  )
}
