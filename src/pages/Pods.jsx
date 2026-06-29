import { useState } from 'react'
import PodCard from '../components/PodCard'
import DataTable from '../components/DataTable'
import { usePodMetrics } from '../hooks/usePodMetrics'
import usePodDesignStore from '../store/usePodDesignStore'
import { formatUSD, formatPct } from '../utils/formatters'
import { POD_COLORS } from '../utils/podColors'

export default function Pods() {
  const [selected, setSelected] = useState(null)
  const { podMetrics, hasDesign } = usePodMetrics()

  const pod = selected ? podMetrics.find(p => p.id === selected) : null

  return (
    <div className="space-y-6">
      {/* Source badge */}
      {hasDesign && (
        <div className="flex items-center gap-2 text-xs text-textSecondary">
          <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
          <span>Reflejando diseño del Diseñador de PODs</span>
        </div>
      )}

      {/* Grid of pods */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {podMetrics.map(p => (
          <PodCard
            key={p.id}
            pod={p}
            onClick={() => setSelected(selected === p.id ? null : p.id)}
          />
        ))}
      </div>

      {/* POD Detail */}
      {pod && (
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <div
            className="px-6 py-5 flex items-center justify-between"
            style={{ backgroundColor: (POD_COLORS[pod.id] || '#4c4c4f') + '15', borderBottom: `3px solid ${POD_COLORS[pod.id] || '#4c4c4f'}` }}
          >
            <div className="flex items-center gap-4">
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold"
                style={{ backgroundColor: POD_COLORS[pod.id] || '#4c4c4f' }}
              >
                {pod.id}
              </div>
              <div>
                <h2 className="text-lg font-bold text-textPrimary">{pod.id} — {pod.nombre}</h2>
                <p className="text-sm text-textSecondary">
                  {pod.metricas.totalClientes} clientes · {pod.metricas.totalEquipo} personas
                </p>
              </div>
            </div>
            <button
              onClick={() => setSelected(null)}
              className="text-textSecondary hover:text-textPrimary p-2 rounded-lg hover:bg-gray-100"
            >
              ✕
            </button>
          </div>

          <div className="p-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Metrics */}
            <div className="space-y-4">
              <h3 className="font-semibold text-textPrimary text-sm">Métricas Financieras</h3>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Revenue', value: pod.metricas.revenue, positive: true },
                  { label: 'Gross Profit', value: pod.metricas.grossProfit, positive: pod.metricas.grossProfit >= 0 },
                  { label: 'Overhead', value: pod.metricas.overhead, positive: false },
                  { label: 'Costo Total', value: pod.metricas.total, positive: false },
                ].map(m => (
                  <div key={m.label} className="bg-gray-50 rounded-xl p-4">
                    <p className="text-xs text-textSecondary mb-1">{m.label}</p>
                    <p className={`text-lg font-bold ${m.positive ? 'text-success' : 'text-danger'}`}>
                      {formatUSD(m.value)}
                    </p>
                  </div>
                ))}
              </div>

              <div className="bg-gray-50 rounded-xl p-4">
                <div className="flex justify-between items-center mb-2">
                  <p className="text-xs text-textSecondary">Margen Neto</p>
                  <div className="flex items-baseline gap-2">
                    <span className={`text-lg font-bold ${pod.metricas.margenPct > 20 ? 'text-success' : pod.metricas.margenPct >= 0 ? 'text-warning' : 'text-danger'}`}>
                      {formatUSD(pod.metricas.margen)}
                    </span>
                    <span className={`text-sm font-semibold ${pod.metricas.margenPct > 20 ? 'text-success' : pod.metricas.margenPct >= 0 ? 'text-warning' : 'text-danger'}`}>
                      {formatPct(pod.metricas.margenPct)}
                    </span>
                  </div>
                </div>
                <div className="h-3 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.min(Math.max((pod.metricas.margenPct + 50) / 100 * 100, 0), 100)}%`,
                      backgroundColor: pod.metricas.margenPct > 20 ? '#10B981' : pod.metricas.margenPct >= 0 ? '#F0B429' : '#EF4444'
                    }}
                  />
                </div>
                <div className="flex justify-between text-xs text-textSecondary mt-1">
                  <span>-50%</span><span>0%</span><span>+50%</span>
                </div>
              </div>
            </div>

            {/* Clients + Team */}
            <div className="space-y-4">
              <h3 className="font-semibold text-textPrimary text-sm">Clientes Asignados</h3>
              {pod.clientes.length > 0 ? (
                <div className="space-y-2">
                  {pod.clientes.map(c => {
                    const maxRev = Math.max(...pod.clientes.map(x => x.revenue), 1)
                    const pct = (c.revenue / maxRev) * 100
                    return (
                      <div key={c.nombre}>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="font-medium text-textPrimary">{c.nombre}</span>
                          <span className="text-textSecondary">{formatUSD(c.revenue)}</span>
                        </div>
                        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full rounded-full"
                            style={{ width: `${pct}%`, backgroundColor: POD_COLORS[pod.id] || '#4c4c4f' }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="text-xs text-textSecondary italic">Sin clientes asignados — usa el Diseñador de PODs</p>
              )}

              <h3 className="font-semibold text-textPrimary text-sm pt-2">Equipo</h3>
              {pod.equipo.length > 0 ? (
                <div className="space-y-2">
                  {pod.equipo.map(m => (
                    <div key={m.nombre} className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <span className="text-xs font-bold text-primary">
                          {m.nombre.split(' ').map(n => n[0]).join('').substring(0, 2)}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between text-xs mb-0.5">
                          <span className="font-medium text-textPrimary truncate">{m.nombre}</span>
                          <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                            <span className="text-textSecondary">{formatUSD(Math.round(m.costoUSD * m.porcentajeDedicacion / 100))}</span>
                            <span className="text-accent font-semibold">{m.porcentajeDedicacion}%</span>
                          </div>
                        </div>
                        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full rounded-full bg-accent"
                            style={{ width: `${m.porcentajeDedicacion}%` }} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-textSecondary italic">Sin equipo asignado — usa el Diseñador de PODs</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
