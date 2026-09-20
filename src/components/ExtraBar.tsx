import { useState } from 'react'
import { getCampusOrigin, setCampusOrigin } from '../lib/origin'
import { clearLocalBundle } from '../lib/ota'
import { resetSchedule } from '../lib/storage'

type ExtraBarProps = {
  undoLabel: string | null
  undoArmed: boolean
  onUndo: () => void
  onExportCsv: () => void
  onExportIcs: () => void
  onImportFile: () => void
  onPasteImport: () => void
}

export function ExtraBar({
  undoLabel,
  undoArmed,
  onUndo,
  onExportCsv,
  onExportIcs,
  onImportFile,
  onPasteImport,
}: ExtraBarProps) {
  const [open, setOpen] = useState(false)
  const [campus, setCampus] = useState(() => getCampusOrigin())

  function persistCampus() {
    setCampusOrigin(campus)
  }

  return (
    <div className="update-wrap extra-wrap">
      <button
        type="button"
        className="ghost update-chip"
        aria-expanded={open}
        onClick={() => {
          const next = !open
          setOpen(next)
          if (next) setCampus(getCampusOrigin())
        }}
      >
        其他功能
      </button>
      {open ? (
        <div className="update-sheet extra-sheet" role="dialog" aria-label="其他功能">
          <div className="update-card-head">
            <strong>其他功能</strong>
            <button type="button" className="ghost" onClick={() => setOpen(false)}>
              收起
            </button>
          </div>
          {undoLabel ? (
            <button
              type="button"
              className={`undo-bar extra-undo${undoArmed ? ' armed' : ''}`}
              onClick={onUndo}
            >
              {undoArmed ? `确定撤销「${undoLabel}」` : `撤销「${undoLabel}」`}
            </button>
          ) : (
            <p className="mute">没有可撤销的操作（改完条目后会出现）</p>
          )}
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
            <label htmlFor="campus-origin">校服务器（CLab，换机只改这个地址）</label>
            <input
              id="campus-origin"
              type="url"
              inputMode="url"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="https://host:8765"
              value={campus}
              onChange={(e) => setCampus(e.target.value)}
              onBlur={persistCampus}
            />
          </div>
          <p className="mute">填了就以校内为准；GitHub 只做改动备份。空着则仍走 GitHub。</p>
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
      ) : null}
    </div>
  )
}
