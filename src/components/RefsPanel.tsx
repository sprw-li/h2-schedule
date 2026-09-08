import { useEffect, useState } from 'react'

import calendarSrc from '../assets/refs/calendar.jpg'
import timetableSrc from '../assets/refs/timetable.jpg'

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

export function RefsPanel() {
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null)

  useEffect(() => {
    if (!lightbox) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightbox(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightbox])

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
        <h3 className="refs-h">学期课程表</h3>
        <button
          type="button"
          className="refs-shot-btn"
          onClick={() => setLightbox({ src: timetableSrc, alt: '本学期课程表照片' })}
        >
          <img className="refs-shot-img" src={timetableSrc} alt="本学期课程表照片（点开看大图）" />
        </button>
        <h3 className="refs-h">校历（2026–2027）</h3>
        <button
          type="button"
          className="refs-shot-btn"
          onClick={() => setLightbox({ src: calendarSrc, alt: '北京大学 2026 至 2027 学年校历' })}
        >
          <img className="refs-shot-img" src={calendarSrc} alt="北京大学校历（点开看大图）" />
        </button>
      </div>
      {lightbox ? (
        <div
          className="lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={lightbox.alt}
          onClick={() => setLightbox(null)}
        >
          <button type="button" className="lightbox-close" aria-label="关闭">
            关闭
          </button>
          <img
            src={lightbox.src}
            alt={lightbox.alt}
            className="lightbox-img"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : null}
    </section>
  )
}
