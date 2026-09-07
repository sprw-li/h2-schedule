import type { ItemKind, ScheduleItem } from '../types'
import { dateKeyFromIcs, formatTimeFromIcs } from './dates'
import { uid } from './storage'

function detectKind(text: string, explicit?: string): ItemKind {
  const blob = `${explicit ?? ''} ${text}`.toLowerCase()
  if (
    /deadline|due|截止|ddl|到期|交稿|提交截止/.test(blob)
  ) {
    return 'deadline'
  }
  return 'task'
}

function makeItem(partial: Omit<ScheduleItem, 'id' | 'done'>): ScheduleItem {
  return {
    id: uid(),
    done: false,
    ...partial,
  }
}

function unfoldIcs(raw: string) {
  return raw.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '')
}

export function parseIcs(raw: string): ScheduleItem[] {
  const text = unfoldIcs(raw)
  const blocks = text.split(/BEGIN:VEVENT/i).slice(1)
  const items: ScheduleItem[] = []
  for (const block of blocks) {
    const body = block.split(/END:VEVENT/i)[0]
    const get = (name: string) => {
      const re = new RegExp(`^${name}[^:]*:(.+)$`, 'im')
      const m = body.match(re)
      return m?.[1]?.trim()
    }
    const summary = get('SUMMARY')
    const start = get('DTSTART') ?? get('DUE')
    if (!summary || !start) continue
    const date = dateKeyFromIcs(start)
    if (!date) continue
    const categories = get('CATEGORIES') ?? ''
    const due = get('DUE')
    items.push(
      makeItem({
        date,
        title: summary.replace(/\\,/g, ',').replace(/\\n/g, ' '),
        kind: detectKind(summary, `${categories} ${due ? 'deadline' : ''}`),
        time: formatTimeFromIcs(due || start),
      }),
    )
  }
  return items
}

export function parseCsv(raw: string): ScheduleItem[] {
  const lines = raw.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim())
  if (lines.length === 0) return []
  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase())
  const idx = (names: string[]) => header.findIndex((h) => names.includes(h))
  const dateI = idx(['date', '日期', 'day'])
  const titleI = idx(['title', 'summary', '标题', '事项', 'name'])
  const timeI = idx(['time', 'due', '时间', '截止时间'])
  const kindI = idx(['kind', 'type', '类型', 'category'])
  const start = header.some((h) => ['date', '日期', 'title', '标题'].includes(h)) ? 1 : 0
  const items: ScheduleItem[] = []
  for (const line of lines.slice(start)) {
    const cols = splitCsvLine(line)
    const dateRaw = (dateI >= 0 ? cols[dateI] : cols[0])?.trim()
    const title = (titleI >= 0 ? cols[titleI] : cols[1])?.trim()
    if (!dateRaw || !title) continue
    const date = normalizeDate(dateRaw)
    if (!date) continue
    const timeRaw = (timeI >= 0 ? cols[timeI] : cols[2])?.trim()
    const kindRaw = (kindI >= 0 ? cols[kindI] : cols[3])?.trim()
    items.push(
      makeItem({
        date,
        title,
        time: normalizeTime(timeRaw),
        kind: detectKind(title, kindRaw),
      }),
    )
  }
  return items
}

export function parseJson(raw: string): ScheduleItem[] {
  const data = JSON.parse(raw) as unknown
  const list = Array.isArray(data)
    ? data
    : data && typeof data === 'object' && Array.isArray((data as { items?: unknown }).items)
      ? (data as { items: unknown[] }).items
      : null
  if (!list) throw new Error('JSON 需为数组，或含 items 数组')
  const items: ScheduleItem[] = []
  for (const row of list) {
    if (!row || typeof row !== 'object') continue
    const rec = row as Record<string, unknown>
    const date = normalizeDate(String(rec.date ?? rec.日期 ?? ''))
    const title = String(rec.title ?? rec.summary ?? rec.标题 ?? '').trim()
    if (!date || !title) continue
    items.push(
      makeItem({
        date,
        title,
        time: normalizeTime(String(rec.time ?? rec.due ?? rec.时间 ?? '')),
        kind: detectKind(title, String(rec.kind ?? rec.type ?? rec.类型 ?? '')),
      }),
    )
  }
  return items
}

export function parseImportFile(name: string, raw: string): ScheduleItem[] {
  const lower = name.toLowerCase()
  if (lower.endsWith('.ics') || raw.includes('BEGIN:VCALENDAR') || raw.includes('BEGIN:VEVENT')) {
    return parseIcs(raw)
  }
  if (lower.endsWith('.json') || raw.trim().startsWith('{') || raw.trim().startsWith('[')) {
    return parseJson(raw)
  }
  return parseCsv(raw)
}

function normalizeDate(value: string) {
  const v = value.trim()
  const iso = v.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/)
  if (iso) {
    return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`
  }
  const compact = v.replace(/[^0-9]/g, '')
  if (compact.length === 8) {
    return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`
  }
  return null
}

function normalizeTime(value?: string) {
  if (!value) return undefined
  const m = value.trim().match(/^(\d{1,2}):(\d{2})/)
  if (!m) return undefined
  return `${m[1].padStart(2, '0')}:${m[2]}`
}

function splitCsvLine(line: string) {
  const out: string[] = []
  let cur = ''
  let q = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"'
        i++
      } else {
        q = !q
      }
    } else if (ch === ',' && !q) {
      out.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out
}
