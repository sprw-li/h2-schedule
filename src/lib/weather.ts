export type PlaceId = 'weihai' | 'haidian' | 'yaohai' | 'shouchun'

export type Place = {
  id: PlaceId
  /** 地点标签上的短名 */
  name: string
  /** 地点标签第二行 */
  area: string
  /** 详情区完整地址（按你给的写法） */
  address: string
  lat: number
  lon: number
}

/** 坐标按校园/镇公开点；天气按该点取 Open-Meteo */
export const PLACES: Place[] = [
  {
    id: 'weihai',
    name: '山大威海',
    area: '环翠区',
    address: '山东大学威海分校 · 威海市环翠区',
    lat: 37.532396,
    lon: 122.058879,
  },
  {
    id: 'haidian',
    name: '北京大学',
    area: '海淀区',
    address: '北京大学 · 北京市海淀区',
    lat: 39.992873,
    lon: 116.310918,
  },
  {
    id: 'yaohai',
    name: '瑶海',
    area: '合肥',
    address: '合肥市瑶海区',
    lat: 31.8601612,
    lon: 117.3037396,
  },
  {
    id: 'shouchun',
    name: '寿春镇',
    area: '寿县',
    address: '淮南市寿县寿春镇',
    lat: 32.58162,
    lon: 116.79291,
  },
]

export type HourPoint = {
  time: string
  hour: string
  temp: number
  pop: number | null
  code: number
  label: string
}

export type DayPoint = {
  date: string
  weekday: string
  code: number
  label: string
  tMax: number
  tMin: number
  rain: number
  hours: HourPoint[]
}

export type PlaceForecast = {
  place: Place
  currentTemp: number | null
  currentLabel: string
  days: DayPoint[]
}

const CACHE_KEY = 'h2-schedule.weather.v3'
const CACHE_MS = 25 * 60 * 1000

const WEEK = ['日', '一', '二', '三', '四', '五', '六']

export function weatherLabel(code: number): string {
  if (code === 0) return '晴'
  if (code === 1) return '大部晴'
  if (code === 2) return '少云'
  if (code === 3) return '阴'
  if (code === 45 || code === 48) return '雾'
  if (code >= 51 && code <= 57) return '毛毛雨'
  if (code >= 61 && code <= 67) return '雨'
  if (code >= 71 && code <= 77) return '雪'
  if (code >= 80 && code <= 82) return '阵雨'
  if (code >= 85 && code <= 86) return '阵雪'
  if (code >= 95) return '雷雨'
  return '多云'
}

type ApiBlock = {
  current?: { temperature_2m?: number; weather_code?: number }
  hourly?: {
    time: string[]
    temperature_2m: number[]
    precipitation_probability?: (number | null)[]
    weather_code: number[]
  }
  daily?: {
    time: string[]
    weather_code: number[]
    temperature_2m_max: number[]
    temperature_2m_min: number[]
    precipitation_sum: number[]
  }
}

type CacheBag = { at: number; data: PlaceForecast[] }

function readCache(): PlaceForecast[] | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const bag = JSON.parse(raw) as CacheBag
    if (!bag?.data || Date.now() - bag.at > CACHE_MS) return null
    return bag.data
  } catch {
    return null
  }
}

function writeCache(data: PlaceForecast[]) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data } satisfies CacheBag))
  } catch {
    /* ignore quota */
  }
}

function parsePlace(place: Place, block: ApiBlock): PlaceForecast {
  const hourly = block.hourly
  const daily = block.daily
  const hoursByDay = new Map<string, HourPoint[]>()
  if (hourly) {
    hourly.time.forEach((iso, i) => {
      const date = iso.slice(0, 10)
      const point: HourPoint = {
        time: iso,
        hour: iso.slice(11, 16),
        temp: hourly.temperature_2m[i] ?? 0,
        pop: hourly.precipitation_probability?.[i] ?? null,
        code: hourly.weather_code[i] ?? 0,
        label: weatherLabel(hourly.weather_code[i] ?? 0),
      }
      const list = hoursByDay.get(date) ?? []
      list.push(point)
      hoursByDay.set(date, list)
    })
  }
  const days: DayPoint[] = (daily?.time ?? []).map((date, i) => {
    const d = new Date(`${date}T12:00:00+08:00`)
    const code = daily?.weather_code[i] ?? 0
    return {
      date,
      weekday: WEEK[d.getDay()] ?? '',
      code,
      label: weatherLabel(code),
      tMax: daily?.temperature_2m_max[i] ?? 0,
      tMin: daily?.temperature_2m_min[i] ?? 0,
      rain: daily?.precipitation_sum[i] ?? 0,
      hours: hoursByDay.get(date) ?? [],
    }
  })
  const curCode = block.current?.weather_code ?? days[0]?.code ?? 0
  return {
    place,
    currentTemp: block.current?.temperature_2m ?? null,
    currentLabel: weatherLabel(curCode),
    days,
  }
}

function forecastUrl(lat: number, lon: number) {
  return (
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    '&current=temperature_2m,weather_code' +
    '&hourly=temperature_2m,precipitation_probability,weather_code' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum' +
    '&forecast_days=7&timezone=Asia%2FShanghai'
  )
}

async function fetchOne(place: Place, signal: AbortSignal): Promise<PlaceForecast> {
  const res = await fetch(forecastUrl(place.lat, place.lon), { signal })
  if (!res.ok) throw new Error(`天气接口 ${res.status}`)
  const json = (await res.json()) as ApiBlock
  if (!json.daily && !json.hourly) throw new Error('天气数据格式不对')
  return parsePlace(place, json)
}

export async function fetchForecasts(): Promise<PlaceForecast[]> {
  const cached = readCache()
  if (cached) return cached
  const ctrl = new AbortController()
  const timer = window.setTimeout(() => ctrl.abort(), 16000)
  try {
    const data = await Promise.all(PLACES.map((place) => fetchOne(place, ctrl.signal)))
    writeCache(data)
    return data
  } finally {
    window.clearTimeout(timer)
  }
}
