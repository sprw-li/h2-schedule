import { useEffect, useMemo, useState } from 'react'
import { PLACES, fetchForecasts, type PlaceForecast, type PlaceId } from '../lib/weather'

export function WeatherPanel() {
  const [data, setData] = useState<PlaceForecast[] | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(true)
  const [placeId, setPlaceId] = useState<PlaceId>('weihai')
  const [dayIndex, setDayIndex] = useState(0)
  const [mode, setMode] = useState<'daily' | 'hourly'>('daily')

  function load(force = false) {
    setBusy(true)
    setErr('')
    if (force) {
      try {
        sessionStorage.removeItem('h2-schedule.weather.v1')
      } catch {
        /* ignore */
      }
    }
    void fetchForecasts()
      .then((next) => {
        setData(next)
        setBusy(false)
      })
      .catch((e: unknown) => {
        setBusy(false)
        setErr(e instanceof Error ? (e.name === 'AbortError' ? '天气请求超时，校园网可能拦了外网' : e.message) : '天气读取失败')
      })
  }

  useEffect(() => {
    load()
  }, [])

  const place = useMemo(
    () => data?.find((p) => p.place.id === placeId) ?? data?.[0] ?? null,
    [data, placeId],
  )
  const day = place?.days[dayIndex] ?? place?.days[0]

  return (
    <section className="panel weather-panel" aria-label="七天天气">
      <div className="sheet-scroll">
      <div className="cal-head">
        <h2>天气</h2>
        <div className="mode-toggle">
          <button type="button" className={mode === 'daily' ? 'solid' : 'ghost'} onClick={() => setMode('daily')}>
            逐日
          </button>
          <button type="button" className={mode === 'hourly' ? 'solid' : 'ghost'} onClick={() => setMode('hourly')}>
            逐时
          </button>
        </div>
      </div>
      <div className="place-tabs" role="tablist" aria-label="地点">
        {PLACES.map((p) => (
          <button
            key={p.id}
            type="button"
            role="tab"
            className={placeId === p.id ? 'on' : ''}
            aria-selected={placeId === p.id}
            onClick={() => {
              setPlaceId(p.id)
              setDayIndex(0)
            }}
          >
            <b>{p.name}</b>
            <span>{p.area}</span>
          </button>
        ))}
      </div>
      {busy && !place ? <p className="empty">正在取天气…</p> : null}
      {err ? (
        <div className="empty">
          <p>{err}</p>
          <button type="button" className="ghost" onClick={() => load(true)}>
            重试
          </button>
        </div>
      ) : null}
      {place ? (
        <>
          <p className="weather-now">
            {place.place.name}
            {place.place.area} · 现在 {place.currentTemp != null ? `${Math.round(place.currentTemp)}℃` : '—'}{' '}
            {place.currentLabel}
          </p>
          {mode === 'daily' ? (
            <div className="weather-days">
              {place.days.map((d, i) => (
                <button
                  key={d.date}
                  type="button"
                  className={`weather-day${i === dayIndex ? ' on' : ''}`}
                  onClick={() => {
                    setDayIndex(i)
                    setMode('hourly')
                  }}
                >
                  <span className="wd-when">
                    {d.date.slice(5)} 周{d.weekday}
                  </span>
                  <span className="wd-label">{d.label}</span>
                  <span className="wd-temp">
                    {Math.round(d.tMax)}° / {Math.round(d.tMin)}°
                  </span>
                  <span className="wd-rain">{d.rain > 0 ? `降水 ${d.rain.toFixed(1)} mm` : '基本无雨'}</span>
                </button>
              ))}
            </div>
          ) : (
            <>
              <div className="weather-day-picker">
                {place.days.map((d, i) => (
                  <button
                    key={d.date}
                    type="button"
                    className={i === dayIndex ? 'solid' : 'ghost'}
                    onClick={() => setDayIndex(i)}
                  >
                    {d.date.slice(5)}
                  </button>
                ))}
              </div>
              {day ? (
                <div className="weather-hours" role="list">
                  {day.hours.map((h) => (
                    <div key={h.time} className="weather-hour" role="listitem">
                      <span>{h.hour}</span>
                      <span>{h.label}</span>
                      <span>{Math.round(h.temp)}℃</span>
                      <span>{h.pop != null ? `${h.pop}%` : '—'}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          )}
        </>
      ) : null}
      </div>
    </section>
  )
}
