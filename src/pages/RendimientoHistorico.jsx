import { useEffect, useState, useCallback, useMemo } from 'react'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { listPeriodos, loadClosedPeriod } from '../services/periodCloseService'
import { formatUSD, formatPct } from '../utils/formatters'

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: '#0A0A0B', borderRadius: 10, padding: '10px 14px',
      fontSize: 11, color: '#fff', minWidth: 180,
    }}>
      <p style={{ fontWeight: 700, marginBottom: 8, color: 'rgba(255,255,255,0.45)', fontSize: 10 }}>
        {label}
      </p>
      {payload.map(p => (
        <div key={p.name} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color, flexShrink: 0 }} />
          <span style={{ color: 'rgba(255,255,255,0.6)', flex: 1 }}>{p.name}</span>
          <span style={{ fontWeight: 700, color: p.color }}>
            {p.name === 'Margen %' ? `${Number(p.value).toFixed(1)}%` : formatUSD(p.value)}
          </span>
        </div>
      ))}
    </div>
  )
}

function Semaforo({ pct }) {
  if (pct > 20) return <span className="w-2 h-2 rounded-full bg-success inline-block flex-shrink-0" />
  if (pct >= 0)  return <span className="w-2 h-2 rounded-full bg-warning inline-block flex-shrink-0" />
  return             <span className="w-2 h-2 rounded-full bg-danger  inline-block flex-shrink-0" />
}

export default function RendimientoHistorico() {
  const [meses, setMeses]     = useState([])
  const [loading, setLoading] = useState(true)
  const [collapsed, setCollapsed] = useState({})

  const toggle = useCallback(codigo =>
    setCollapsed(prev => ({ ...prev, [codigo]: !prev[codigo] })),
  [])

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const periodos = await listPeriodos()
        const cerrados = periodos.filter(p => p.estado === 'cerrado')
        const settled  = await Promise.allSettled(
          cerrados.map(async p => {
            const snap = await loadClosedPeriod(p.id)
            return { label: p.label, codigo: p.codigo, snap }
          })
        )
        setMeses(
          settled
            .filter(r => r.status === 'fulfilled' && r.value.snap?.metrics)
            .map(r => r.value)
        )
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  // Debe estar antes de los early returns para respetar Rules of Hooks
  const chartData = useMemo(() =>
    meses.map(({ label, snap }) => {
      const g = snap.metrics?.globalMetrics || {}
      return {
        mes:       label,
        revenue:   g.revenue   || 0,
        margen:    g.margin    || 0,
        margenPct: g.marginPct || 0,
      }
    }),
  [meses])

  if (loading) {
    return <p className="text-sm text-textSecondary py-10 text-center">Cargando histórico…</p>
  }

  if (meses.length === 0) {
    return (
      <div className="text-center py-16">
        <p className="text-sm text-textSecondary">No hay períodos cerrados todavía.</p>
        <p className="text-xs text-textSecondary mt-1">Cerrá un mes desde el Diseñador de PODs para verlo aquí.</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">

      {/* Gráfico comparativo */}
      {chartData.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-bold text-textPrimary">Evolución mensual</h2>
              <p className="text-xs text-textSecondary mt-0.5">Revenue · Margen USD · Margen %</p>
            </div>
            <div className="flex items-center gap-4 text-xs text-textSecondary">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm inline-block" style={{ background: '#59D7A2' }} /> Revenue
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm inline-block" style={{ background: '#0A2540' }} /> Margen USD
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-6 h-0.5 inline-block" style={{ background: '#F0B429' }} /> Margen %
              </span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={chartData} margin={{ top: 4, right: 24, left: 10, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
              <XAxis
                dataKey="mes"
                tick={{ fontSize: 11, fill: '#6B7280', fontFamily: 'var(--font-mono)' }}
                axisLine={false} tickLine={false}
              />
              <YAxis
                yAxisId="usd"
                tickFormatter={v => `${(v / 1000).toFixed(0)}k`}
                tick={{ fontSize: 10, fill: '#9CA3AF' }}
                axisLine={false} tickLine={false}
              />
              <YAxis
                yAxisId="pct"
                orientation="right"
                tickFormatter={v => `${v}%`}
                tick={{ fontSize: 10, fill: '#9CA3AF' }}
                axisLine={false} tickLine={false}
                domain={[0, 'auto']}
              />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(10,10,11,0.03)' }} />
              <ReferenceLine yAxisId="pct" y={20} stroke="#F0B429" strokeDasharray="4 3" strokeWidth={1.5} />
              <Bar yAxisId="usd" dataKey="revenue" name="Revenue"    fill="#59D7A2" radius={[4,4,0,0]} maxBarSize={40} />
              <Bar yAxisId="usd" dataKey="margen"  name="Margen USD" fill="#0A2540" radius={[4,4,0,0]} maxBarSize={40} />
              <Line
                yAxisId="pct" dataKey="margenPct" name="Margen %"
                stroke="#F0B429" strokeWidth={2.5} dot={{ r: 4, fill: '#F0B429', strokeWidth: 0 }}
                activeDot={{ r: 6 }} type="monotone"
              />
            </ComposedChart>
          </ResponsiveContainer>
          <p className="text-[10px] text-textSecondary mt-2 text-right">
            Línea punteada = objetivo 20% margen
          </p>
        </div>
      )}

      {meses.map(({ label, codigo, snap }) => {
        const pods   = snap.metrics?.podMetrics   || []
        const global = snap.metrics?.globalMetrics || {}
        const activePods = pods.filter(p => p.revenue > 0 || p.teamCost > 0)

        return (
          <div key={codigo} className="bg-white rounded-2xl shadow-sm overflow-hidden">

            {/* Cabecera del mes */}
            <button
              onClick={() => toggle(codigo)}
              className="w-full px-5 py-3 flex items-center justify-between hover:bg-gray-50/60 transition-colors"
              style={{ borderBottom: collapsed[codigo] ? 'none' : '1px solid #f3f4f6' }}
            >
              <div className="flex items-center gap-3">
                <svg
                  width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5"
                  viewBox="0 0 24 24"
                  className="text-textSecondary flex-shrink-0 transition-transform duration-200"
                  style={{ transform: collapsed[codigo] ? 'rotate(-90deg)' : 'rotate(0deg)' }}
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
                <span className="text-sm font-bold text-textPrimary">{label}</span>
                <span className="text-xs text-textSecondary">{activePods.length} PODs</span>
              </div>
              <div className="flex items-center gap-5 text-xs text-textSecondary">
                <span>
                  Revenue{' '}
                  <span className="font-semibold text-textPrimary ml-1">{formatUSD(global.revenue)}</span>
                </span>
                <span>
                  Margen{' '}
                  <span className={`font-bold ml-1 ${
                    global.marginPct > 20 ? 'text-success' :
                    global.marginPct >= 0 ? 'text-warning' : 'text-danger'
                  }`}>
                    {formatUSD(global.margin)}
                  </span>
                  <span className={`ml-1 ${
                    global.marginPct > 20 ? 'text-success' :
                    global.marginPct >= 0 ? 'text-warning' : 'text-danger'
                  }`}>
                    ({formatPct(global.marginPct)})
                  </span>
                </span>
              </div>
            </button>

            {!collapsed[codigo] && <table className="w-full">
              <thead>
                <tr>
                  <th className="text-left text-[10px] font-semibold text-textSecondary uppercase tracking-wide px-5 py-2">POD</th>
                  <th className="text-right text-[10px] font-semibold text-textSecondary uppercase tracking-wide px-4 py-2">Revenue</th>
                  <th className="text-right text-[10px] font-semibold text-textSecondary uppercase tracking-wide px-4 py-2">Margen USD</th>
                  <th className="text-right text-[10px] font-semibold text-textSecondary uppercase tracking-wide px-5 py-2">Margen %</th>
                </tr>
              </thead>
              <tbody>
                {activePods.map(pod => (
                  <tr key={pod.id} className="border-t border-gray-50 hover:bg-gray-50/50 transition-colors">
                    <td className="px-5 py-2.5">
                      <div className="flex items-center gap-2">
                        <Semaforo pct={pod.marginPct} />
                        <span className="text-xs font-semibold text-textPrimary">{pod.id}</span>
                        {pod.nombre && (
                          <span className="text-xs text-textSecondary truncate max-w-[180px]">{pod.nombre}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right text-xs font-semibold text-textPrimary">
                      {formatUSD(pod.revenue)}
                    </td>
                    <td className={`px-4 py-2.5 text-right text-xs font-semibold ${pod.margin >= 0 ? 'text-success' : 'text-danger'}`}>
                      {formatUSD(pod.margin)}
                    </td>
                    <td className="px-5 py-2.5 text-right">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                        pod.marginPct > 20 ? 'bg-success/10 text-success' :
                        pod.marginPct >= 0 ? 'bg-warning/10 text-warning' :
                        'bg-danger/10 text-danger'
                      }`}>
                        {formatPct(pod.marginPct)}
                      </span>
                    </td>
                  </tr>
                ))}

                {/* Fila total */}
                <tr className="border-t border-gray-100 bg-gray-50">
                  <td className="px-5 py-2.5 text-xs font-bold text-textSecondary">Total</td>
                  <td className="px-4 py-2.5 text-right text-xs font-bold text-textPrimary">
                    {formatUSD(global.revenue)}
                  </td>
                  <td className={`px-4 py-2.5 text-right text-xs font-bold ${global.margin >= 0 ? 'text-success' : 'text-danger'}`}>
                    {formatUSD(global.margin)}
                  </td>
                  <td className="px-5 py-2.5 text-right">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                      global.marginPct > 20 ? 'bg-success/10 text-success' :
                      global.marginPct >= 0 ? 'bg-warning/10 text-warning' :
                      'bg-danger/10 text-danger'
                    }`}>
                      {formatPct(global.marginPct)}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>}
          </div>
        )
      })}
    </div>
  )
}
