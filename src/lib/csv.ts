import type { ItemKind, ScheduleItem, ScheduleMap } from '../types'
import { flattenItems, replaceSchedule } from './backup'
import { pad } from './dates'
import { itemKey, normalizeSchedule } from './schedule'

const KINDS = new Set<ItemKind>(['task', 'deadline', 'holiday'])

function esc(cell: string) {
  if (/[",\n\r]/.test(cell)) return `"${cell.replace(/"/g, '""')}"`
  return cell
}

function parseRow(line: string, sep: string): string[] {
  const out: string[] = []
  let cur = ''
  let q = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (q) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (ch === '"') q = false
      else cur += ch
    } else if (ch === '"') q = true
    else if (ch === sep) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out
}

function detectSep(headerLine: string) {
  if (headerLine.includes('\t')) return '\t'
  const commas = (headerLine.match(/,/g) || []).length
  const semis = (headerLine.match(/;/g) || []).length
  return semis > commas ? ';' : ','
}

/** Excel 日期、2026/9/21、2026.9.21、2026年9月21日 → YYYY-MM-DD */
export function parseCsvDate(raw: string): string | null {
  const s = String(raw || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const cn = /^(\d{4})[/.年\- ](\d{1,2})[/.月\- ](\d{1,2})/.exec(s)
  if (cn) return `${cn[1]}-${pad(Number(cn[2]))}-${pad(Number(cn[3]))}`
  const n = Number(s)
  if (Number.isFinite(n) && n > 20000 && n < 80000) {
    const utc = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000)
    return `${utc.getUTCFullYear()}-${pad(utc.getUTCMonth() + 1)}-${pad(utc.getUTCDate())}`
  }
  return null
}

/** 导出全量日程为 CSV（UTF-8 BOM，Excel 可开） */
export function scheduleToCsv(map: ScheduleMap) {
  const header = ['date', 'kind', 'title', 'done', 'start', 'end', 'allDay', 'id']
  const rows = flattenItems(map).map((i) =>
    [
      i.date,
      i.kind,
      i.title,
      i.done ? '1' : '0',
      i.start ?? '',
      i.end ?? '',
      i.allDay ? '1' : '0',
      i.id,
    ]
      .map((c) => esc(String(c)))
      .join(','),
  )
  return `\uFEFF${[header.join(','), ...rows].join('\n')}\n`
}

export function csvToItems(text: string): ScheduleItem[] {
  const raw = text.replace(/^\uFEFF/, '').trim()
  if (!raw) return []
  const lines = raw.split(/\r?\n/).filter((l) => l.trim())
  if (lines.length < 2) return []
  const sep = detectSep(lines[0])
  const header = parseRow(lines[0], sep).map((h) => h.trim().toLowerCase().replace(/\s+/g, ''))
  const idx = (name: string) => header.indexOf(name)
  const iDate = idx('date') >= 0 ? idx('date') : idx('日期')
  const iKind = idx('kind') >= 0 ? idx('kind') : idx('类型')
  const iTitle = idx('title') >= 0 ? idx('title') : idx('标题')
  const iDone = idx('done')
  const iStart = idx('start') >= 0 ? idx('start') : idx('起')
  const iEnd = idx('end') >= 0 ? idx('end') : idx('止')
  const iAll = idx('allday')
  const iId = idx('id')
  if (iDate < 0 || iTitle < 0) throw new Error('CSV 缺少 date/title 列（用本 App 导出的文件即可）')

  const items: ScheduleItem[] = []
  const seenIds = new Set<string>()
  for (const line of lines.slice(1)) {
    const cols = parseRow(line, sep)
    const date = parseCsvDate(cols[iDate] || '')
    const title = (cols[iTitle] || '').trim()
    if (!date || !title) continue
    const kindRaw = (iKind >= 0 ? cols[iKind] : 'task')?.trim() || 'task'
    const kind = (KINDS.has(kindRaw as ItemKind) ? kindRaw : 'task') as ItemKind
    const doneCell = (iDone >= 0 ? cols[iDone] : '0')?.trim().toLowerCase() || '0'
    const done = doneCell === '1' || doneCell === 'true' || doneCell === 'yes'
    const allDayCell = (iAll >= 0 ? cols[iAll] : '0')?.trim().toLowerCase() || '0'
    const allDay = allDayCell === '1' || allDayCell === 'true'
    const start = iStart >= 0 ? cols[iStart]?.trim() || undefined : undefined
    const end = iEnd >= 0 ? cols[iEnd]?.trim() || undefined : undefined
    let id = (iId >= 0 ? cols[iId]?.trim() : '') || cryptoRandomId()
    if (!id || seenIds.has(id)) id = cryptoRandomId()
    seenIds.add(id)
    const row: ScheduleItem = { id, date, title, done, kind }
    if (allDay) row.allDay = true
    else {
      if (start) row.start = start
      if (end) row.end = end
    }
    items.push(row)
  }
  return items
}

function cryptoRandomId() {
  try {
    return crypto.randomUUID()
  } catch {
    return `csv-${Date.now()}-${Math.random().toString(16).slice(2)}`
  }
}

/** 导入：按「日期+类型+标题」对齐；不按科目族乱合并，避免改一条串多条 */
export function mergeCsvIntoSchedule(map: ScheduleMap, csvText: string): ScheduleMap {
  const incoming = csvToItems(csvText)
  if (incoming.length === 0) {
    throw new Error('CSV 里没有有效行（日期需为 2026-09-21 或 2026/9/21）')
  }
  const local = flattenItems(map)
  const byExact = new Map<string, ScheduleItem>()
  const usedIds = new Set<string>()
  for (const it of local) {
    byExact.set(itemKey(it), { ...it })
    usedIds.add(it.id)
  }
  for (const it of incoming) {
    const k = itemKey(it)
    const prev = byExact.get(k)
    if (!prev) {
      let id = it.id
      if (!id || usedIds.has(id)) id = cryptoRandomId()
      usedIds.add(id)
      byExact.set(k, { ...it, id })
      continue
    }
    byExact.set(k, {
      ...prev,
      ...it,
      id: prev.id,
      done: !!(prev.done || it.done),
    })
  }
  return normalizeSchedule(replaceSchedule([...byExact.values()]))
}

export async function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const file = new File([blob], filename, { type: 'text/csv;charset=utf-8' })
  const nav = navigator as Navigator & {
    canShare?: (data: ShareData) => boolean
    share?: (data: ShareData) => Promise<void>
  }
  try {
    if (nav.share && nav.canShare?.({ files: [file] })) {
      await nav.share({ files: [file], title: filename, text: filename })
      return 'share'
    }
  } catch {
    /* 用户取消分享时走下载/复制 */
  }
  try {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.rel = 'noopener'
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    window.setTimeout(() => {
      a.remove()
      URL.revokeObjectURL(url)
    }, 1000)
    return 'file'
  } catch {
    /* ignore */
  }
  try {
    await navigator.clipboard.writeText(csv)
    return 'clipboard'
  } catch {
    throw new Error('无法导出，请换浏览器或电脑再试')
  }
}
