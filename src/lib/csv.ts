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

function col(header: string[], ...names: string[]) {
  for (const n of names) {
    const i = header.indexOf(n)
    if (i >= 0) return i
  }
  return -1
}

function parseHm(raw: string): string | undefined {
  const s = raw.trim().replace(/：/g, ':')
  const m = /^(\d{1,2}):(\d{2})/.exec(s)
  if (!m) return undefined
  return `${pad(Number(m[1]))}:${m[2]}`
}

function parseTimeSpan(raw: string): { start?: string; end?: string } {
  const s = raw.trim().replace(/：/g, ':')
  if (!s) return {}
  const m = /^(\d{1,2}:\d{2})(?:\s*[-–~到至]\s*(\d{1,2}:\d{2}))?/.exec(s)
  if (!m) return {}
  return { start: parseHm(m[1]), end: m[2] ? parseHm(m[2]) : undefined }
}

export function csvToItems(text: string): ScheduleItem[] {
  const raw = text.replace(/^\uFEFF/, '').trim()
  if (!raw) return []
  const lines = raw.split(/\r?\n/).filter((l) => l.trim())
  if (lines.length < 2) return []
  const sep = detectSep(lines[0])
  const header = parseRow(lines[0], sep).map((h) => h.trim().toLowerCase().replace(/\s+/g, ''))
  const iDate = col(header, 'date', '日期', 'day')
  const iKind = col(header, 'kind', '类型', '颜色')
  const iTitle = col(header, 'title', '标题', '事项', '内容')
  const iDone = col(header, 'done', '完成')
  const iStart = col(header, 'start', '起', '开始')
  const iEnd = col(header, 'end', '止', '结束')
  const iTime = col(header, 'time', '时间', '时刻')
  const iAll = col(header, 'allday', '全天')
  const iId = col(header, 'id')
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
    let allDay = allDayCell === '1' || allDayCell === 'true'
    let start = iStart >= 0 ? parseHm(cols[iStart] || '') : undefined
    let end = iEnd >= 0 ? parseHm(cols[iEnd] || '') : undefined
    if (!start && !end && iTime >= 0) {
      const span = parseTimeSpan(cols[iTime] || '')
      start = span.start
      end = span.end
    }
    if (!start && !end) allDay = true
    else allDay = allDayCell === '1' || allDayCell === 'true'
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

/** 导入：先按 id，再按「日期+类型+标题」；不按科目族乱合并 */
export function mergeCsvIntoSchedule(map: ScheduleMap, csvText: string): ScheduleMap {
  const incoming = csvToItems(csvText)
  if (incoming.length === 0) {
    throw new Error('CSV 里没有有效行（日期需为 2026-09-21 或 2026/9/21）')
  }
  const local = flattenItems(map)
  const byId = new Map(local.map((it) => [it.id, { ...it }]))
  const byExact = new Map<string, ScheduleItem>()
  const usedIds = new Set<string>()
  for (const it of local) {
    byExact.set(itemKey(it), { ...it })
    usedIds.add(it.id)
  }
  for (const it of incoming) {
    const prevId = it.id && byId.has(it.id) ? byId.get(it.id) : undefined
    if (prevId) {
      const next = { ...prevId, ...it, id: prevId.id }
      byId.set(prevId.id, next)
      byExact.delete(itemKey(prevId))
      byExact.set(itemKey(next), next)
      continue
    }
    const k = itemKey(it)
    const prev = byExact.get(k)
    if (!prev) {
      let id = it.id
      if (!id || usedIds.has(id)) id = cryptoRandomId()
      usedIds.add(id)
      const row = { ...it, id }
      byExact.set(k, row)
      byId.set(id, row)
      continue
    }
    const merged = {
      ...prev,
      ...it,
      id: prev.id,
      done: !!(prev.done || it.done),
    }
    byExact.set(k, merged)
    byId.set(prev.id, merged)
  }
  return normalizeSchedule(replaceSchedule([...byExact.values()]))
}

export async function readCsvText(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  const bytes = new Uint8Array(buf)
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes)
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes)
  }
  return new TextDecoder('utf-8').decode(bytes)
}

export async function downloadCsv(filename: string, csv: string): Promise<'share' | 'file' | 'text'> {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const file = new File([blob], filename, { type: 'text/csv;charset=utf-8' })
  const nav = navigator as Navigator & {
    canShare?: (data: ShareData) => boolean
    share?: (data: ShareData) => Promise<void>
  }
  const native = !!(
    window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }
  ).Capacitor?.isNativePlatform?.()

  try {
    if (nav.share && nav.canShare?.({ files: [file] })) {
      await nav.share({ files: [file], title: filename, text: filename })
      return 'share'
    }
  } catch {
    /* 取消或 WebView 不支持带文件分享 */
  }

  if (native && nav.share) {
    try {
      await nav.share({ title: filename, text: csv })
      return 'share'
    } catch {
      /* 取消则改在界面里展示文本 */
    }
  }

  if (!native) {
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
  }

  return 'text'
}
