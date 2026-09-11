import type { ItemKind, ScheduleItem, ScheduleMap } from '../types'
import { flattenItems, replaceSchedule } from './backup'
import { normalizeSchedule, softKey } from './schedule'

const KINDS = new Set<ItemKind>(['task', 'deadline', 'holiday'])

function esc(cell: string) {
  if (/[",\n\r]/.test(cell)) return `"${cell.replace(/"/g, '""')}"`
  return cell
}

function parseRow(line: string): string[] {
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
    else if (ch === ',') {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out
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
  const header = parseRow(lines[0]).map((h) => h.trim().toLowerCase())
  const idx = (name: string) => header.indexOf(name)
  const iDate = idx('date')
  const iKind = idx('kind')
  const iTitle = idx('title')
  const iDone = idx('done')
  const iStart = idx('start')
  const iEnd = idx('end')
  const iAll = idx('allday')
  const iId = idx('id')
  if (iDate < 0 || iTitle < 0) throw new Error('CSV 缺少 date/title 列')

  const items: ScheduleItem[] = []
  for (const line of lines.slice(1)) {
    const cols = parseRow(line)
    const date = (cols[iDate] || '').trim()
    const title = (cols[iTitle] || '').trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !title) continue
    const kindRaw = (iKind >= 0 ? cols[iKind] : 'task')?.trim() || 'task'
    const kind = (KINDS.has(kindRaw as ItemKind) ? kindRaw : 'task') as ItemKind
    const doneCell = (iDone >= 0 ? cols[iDone] : '0')?.trim().toLowerCase() || '0'
    const done = doneCell === '1' || doneCell === 'true' || doneCell === 'yes'
    const allDayCell = (iAll >= 0 ? cols[iAll] : '0')?.trim().toLowerCase() || '0'
    const allDay = allDayCell === '1' || allDayCell === 'true'
    const start = iStart >= 0 ? cols[iStart]?.trim() || undefined : undefined
    const end = iEnd >= 0 ? cols[iEnd]?.trim() || undefined : undefined
    const id = (iId >= 0 ? cols[iId]?.trim() : '') || cryptoRandomId()
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

/** 导入：与本机并集；同 soft key 时 done 取或，标题/时间以 CSV 为准 */
export function mergeCsvIntoSchedule(map: ScheduleMap, csvText: string): ScheduleMap {
  const incoming = csvToItems(csvText)
  if (incoming.length === 0) throw new Error('CSV 里没有有效行')
  const local = flattenItems(map)
  const bySoft = new Map<string, ScheduleItem>()
  for (const it of local) bySoft.set(softKey(it), { ...it })
  for (const it of incoming) {
    const k = softKey(it)
    const prev = bySoft.get(k)
    if (!prev) {
      bySoft.set(k, { ...it })
      continue
    }
    bySoft.set(k, {
      ...prev,
      ...it,
      id: prev.id || it.id,
      done: !!(prev.done || it.done),
    })
  }
  return normalizeSchedule(replaceSchedule([...bySoft.values()]))
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
