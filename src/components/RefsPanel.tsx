import { useEffect, useRef, useState } from 'react'

import calendarBundled from '../assets/refs/calendar.jpg'
import timetableBundled from '../assets/refs/timetable.jpg'
import { getWriteToken } from '../lib/cloud'
import {
  fileToJpegDataUrl,
  resolveRefSrc,
  uploadRefImage,
  type RefKind,
} from '../lib/refs-images'

const PERIODS: { n: string; t: string; note?: string }[] = [
  { n: '第一节', t: '8:00-8:50' },
  { n: '第二节', t: '9:00-9:50' },
  { n: '第三节', t: '10:10-11:00' },
  { n: '第四节', t: '11:10-12:00' },
  { n: '第五节', t: '13:00-13:50' },
  { n: '第六节', t: '14:00-14:50' },
  { n: '第七节', t: '15:10-16:00' },
  { n: '第八节', t: '16:10-17:00' },
  { n: '第九节', t: '17:10-18:00', note: '机动课时' },
  { n: '第十节', t: '18:40-19:30' },
  { n: '第十一节', t: '19:40-20:30' },
  { n: '第十二节', t: '20:40-21:30', note: '机动课时 / 晚自习' },
]

const TERM_NOTES: { title: string; lines: string[] }[] = [
  {
    title: '2026–2027 第一学期（校本部）',
    lines: [
      '上课：9 月 7 日',
      '中秋：9 月 25 日放假全校停课；9 月 26–27 日调休，课程按原课表',
      '国庆：9 月 30 日调休按课表；10 月 1–7 日放假全校停课；10 月 10 日调休按课表',
      '校运会：10 月 10–11 日',
      '停课复习考试：12 月 28 日–1 月 10 日',
      '学生寒假：1 月 11 日–2 月 21 日',
    ],
  },
  {
    title: '2026–2027 第二学期（校本部）',
    lines: [
      '上课：2 月 22 日',
      '劳动节：5 月 1 日放假；5 月 2–7 日调休全校停课；5 月 4 日部分单位上班、全校停课；5 月 8–9 日调休按课表',
      '停课复习考试：6 月 14–27 日',
      '暑假：6 月 28 日起；小学期 7 月 5 日–8 月 8 日',
    ],
  },
]

type Shot = { kind: RefKind; title: string; bundled: string; alt: string }

const SHOTS: Shot[] = [
  {
    kind: 'timetable',
    title: '学期课程表',
    bundled: timetableBundled,
    alt: '本学期课程表照片',
  },
  {
    kind: 'calendar',
    title: '校历（2026–2027）',
    bundled: calendarBundled,
    alt: '北京大学 2026 至 2027 学年校历',
  },
]

export function RefsPanel() {
  const [srcs, setSrcs] = useState<Record<RefKind, string>>({
    timetable: timetableBundled,
    calendar: calendarBundled,
  })
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null)
  const [scale, setScale] = useState(1)
  const [replaceKind, setReplaceKind] = useState<RefKind | null>(null)
  const [phrase, setPhrase] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const pendingFile = useRef<File | null>(null)
  const pinch0 = useRef(0)

  useEffect(() => {
    let stop = false
    void (async () => {
      const next = { ...srcs }
      for (const shot of SHOTS) {
        next[shot.kind] = await resolveRefSrc(shot.kind, shot.bundled)
      }
      if (!stop) setSrcs(next)
    })()
    return () => {
      stop = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hydrate once
  }, [])

  useEffect(() => {
    if (!lightbox) return
    setScale(1)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightbox(null)
      if (e.key === '+' || e.key === '=') setScale((s) => Math.min(4, +(s + 0.25).toFixed(2)))
      if (e.key === '-' || e.key === '_') setScale((s) => Math.max(1, +(s - 0.25).toFixed(2)))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightbox])

  function openReplace(kind: RefKind) {
    setReplaceKind(kind)
    setPhrase('')
    setErr('')
    setNote(getWriteToken() ? '已开通同步，选图后即可更换' : '更换图片需要口令')
    pendingFile.current = null
  }

  async function doUpload(file: File) {
    if (!replaceKind) return
    setBusy(true)
    setErr('')
    setNote('正在处理…')
    try {
      const dataUrl = await fileToJpegDataUrl(file)
      await uploadRefImage(replaceKind, dataUrl, phrase)
      setSrcs((cur) => ({ ...cur, [replaceKind]: dataUrl }))
      setNote('已更换')
      setPhrase('')
      window.setTimeout(() => {
        setReplaceKind(null)
        setNote('')
      }, 600)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '更换失败')
      setNote('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel refs-panel" aria-label="课表与校历">
      <div className="cal-head">
        <h2>资料</h2>
      </div>
      <div className="sheet-scroll">
        <h3 className="refs-h">校本部标准课时</h3>
        <table className="period-table">
          <tbody>
            {PERIODS.map((p) => (
              <tr key={p.n}>
                <th>{p.n}</th>
                <td className="period-time">{p.t}</td>
                <td>{p.note ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {TERM_NOTES.map((block) => (
          <div key={block.title} className="term-notes">
            <h3 className="refs-h">{block.title}</h3>
            <ul>
              {block.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        ))}
        {SHOTS.map((shot) => (
          <div key={shot.kind} className="refs-block">
            <div className="refs-block-head">
              <h3 className="refs-h">{shot.title}</h3>
              <button type="button" className="ghost refs-replace-btn" onClick={() => openReplace(shot.kind)}>
                更换图片
              </button>
            </div>
            <button
              type="button"
              className="refs-shot-btn"
              onClick={() => setLightbox({ src: srcs[shot.kind], alt: shot.alt })}
            >
              <img className="refs-shot-img" src={srcs[shot.kind]} alt={`${shot.alt}（点开放大）`} />
            </button>
          </div>
        ))}
      </div>

      {lightbox ? (
        <div
          className="lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={lightbox.alt}
          onClick={() => setLightbox(null)}
        >
          <div className="lightbox-toolbar" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="lightbox-tool" onClick={() => setScale((s) => Math.max(1, +(s - 0.25).toFixed(2)))}>
              缩小
            </button>
            <span className="lightbox-scale">{Math.round(scale * 100)}%</span>
            <button type="button" className="lightbox-tool" onClick={() => setScale((s) => Math.min(4, +(s + 0.25).toFixed(2)))}>
              放大
            </button>
            <button type="button" className="lightbox-tool" onClick={() => setScale(1)}>
              复位
            </button>
            <button type="button" className="lightbox-close" aria-label="关闭" onClick={() => setLightbox(null)}>
              关闭
            </button>
          </div>
          <div
            className="lightbox-stage"
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={() => setScale((s) => (s > 1.2 ? 1 : 2))}
            onTouchStart={(e) => {
              if (e.touches.length === 2) {
                const a = e.touches[0]
                const b = e.touches[1]
                pinch0.current = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) / scale
              }
            }}
            onTouchMove={(e) => {
              if (e.touches.length === 2 && pinch0.current > 0) {
                e.preventDefault()
                const a = e.touches[0]
                const b = e.touches[1]
                const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
                setScale(Math.min(4, Math.max(1, dist / pinch0.current)))
              }
            }}
            onTouchEnd={() => {
              pinch0.current = 0
            }}
          >
            <img
              src={lightbox.src}
              alt={lightbox.alt}
              className="lightbox-img"
              style={{ transform: `scale(${scale})` }}
              draggable={false}
            />
          </div>
        </div>
      ) : null}

      {replaceKind ? (
        <div className="sync-scrim" onClick={() => !busy && setReplaceKind(null)}>
          <form
            className="sync-card"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault()
              if (!getWriteToken() && !phrase.trim()) {
                setErr('还没填口令')
                return
              }
              if (pendingFile.current) {
                void doUpload(pendingFile.current)
                return
              }
              fileRef.current?.click()
            }}
          >
            <h2>更换图片</h2>
            <p>课表或校历照片会同步到手机和电脑。需要口令。</p>
            {!getWriteToken() ? (
              <>
                <label htmlFor="ref-phrase">口令</label>
                <input
                  id="ref-phrase"
                  type="password"
                  autoComplete="current-password"
                  value={phrase}
                  disabled={busy}
                  onChange={(e) => setPhrase(e.target.value)}
                />
              </>
            ) : (
              <>
                <label htmlFor="ref-phrase-opt">口令（可留空）</label>
                <input
                  id="ref-phrase-opt"
                  type="password"
                  autoComplete="current-password"
                  value={phrase}
                  disabled={busy}
                  onChange={(e) => setPhrase(e.target.value)}
                />
              </>
            )}
            {note ? <p className="update-note">{note}</p> : null}
            {err ? <p className="unlock-error">{err}</p> : null}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (!file) return
                pendingFile.current = file
                void doUpload(file)
              }}
            />
            <div className="sync-actions">
              <button className="solid" type="submit" disabled={busy}>
                {busy ? '处理中…' : '选择图片'}
              </button>
              <button className="ghost" type="button" disabled={busy} onClick={() => setReplaceKind(null)}>
                取消
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  )
}
