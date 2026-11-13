// Two cards for Stats (1.4.13): personal records, and body weight against training volume.
// Both read only what is already on the device (lib/records.js, lib/trend-volume.js); nothing here
// writes, and neither card appears until there is something to show.
import { useNavigate } from 'react-router-dom'
import { t } from '../lib/i18n.js'
import { EXIDX } from '../lib/exercises.js'
import { fmtNum, fmtDate, exerciseNameText } from '../lib/format.js'
import { recentRecords } from '../lib/records.js'
import { weeklyTrend, trendSeries } from '../lib/trend-volume.js'
import LineChart from './LineChart.jsx'
import { ChartLegend } from './StatBars.jsx'
import { Button } from './ui.jsx'
import { exerciseHistorySheet } from '../sheets.jsx'

const nameOf = id => (EXIDX[id] ? exerciseNameText(EXIDX[id]) : id)

export function RecordsCard({ S, limit = 6 }) {
  const nav = useNavigate()
  const rows = recentRecords(S, limit)
  if (!rows.length) return null
  return <div className="card">
    <h2>{t('Personal records')}</h2>
    <div className="small dim" style={{ marginBottom: 6 }}>
      {t('The heaviest set logged for each exercise you have trained recently. Warm-ups and assistance machines stay out.')}
    </div>
    {rows.map(r => <div key={r.id} className="ex-day" onClick={() => exerciseHistorySheet(r.id)}>
      <span className="ex-day-d">{nameOf(r.id)}</span>
      <span className="ex-day-s">
        <b>{fmtNum(r.heaviest.w)} {S.unit}</b> × {r.heaviest.r}
        {r.e1rm ? <span className="dim">{` · ${t('est. 1RM')} ${fmtNum(r.e1rm.est)}`}</span> : null}
      </span>
      <span className="ex-day-e dim">{fmtDate(r.heaviest.d, true)}</span>
    </div>)}
    <div className="row" style={{ justifyContent: 'flex-end', marginTop: 4 }}>
      <Button size="sm" variant="ghost" trailingIcon="chevronRight" onClick={() => nav('/history')}>{t('Open history')}</Button>
    </div>
  </div>
}

export function VolumeWeightCard({ S, weeks = 12 }) {
  const rows = weeklyTrend(S, { weeks })
  const { points, series } = trendSeries(rows)
  if (points.length < 2) return null
  return <div className="card">
    <h2>{t('Weight and volume')}</h2>
    <div className="small dim" style={{ marginBottom: 6 }}>
      {t('Both as an index, 100 at the first week shown: is the work climbing while the weight holds?')}
    </div>
    <div className="chart"><LineChart points={points} series={series} h={170} unit="%" /></div>
    <ChartLegend items={[
      { key: 'v', mark: 'dot', color: 'var(--acc)', label: t('Training volume') },
      ...(series.length > 1 ? [{ key: 'b', mark: 'dot', color: 'var(--teal)', label: t('Body weight') }] : []),
    ]} />
  </div>
}
