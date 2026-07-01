import { useEffect, useState } from 'react'
import { listPeriodos, loadClosedPeriod } from '../services/periodCloseService'
import { formatUSD, formatPct } from '../utils/formatters'

function Semaforo({ pct }) {
  if (pct > 20) return <span className="w-2 h-2 rounded-full bg-success inline-block flex-shrink-0" />
  if (pct >= 0)  return <span className="w-2 h-2 rounded-full bg-warning inline-block flex-shrink-0" />
  return             <span className="w-2 h-2 rounded-full bg-danger  inline-block flex-shrink-0" />
}

export default function RendimientoHistorico() {
  const [meses, setMeses]   = useState([])
  const [loading, setLoading] = useState(true)

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
      {meses.map(({ label, codigo, snap }) => {
        const pods   = snap.metrics?.podMetrics   || []
        const global = snap.metrics?.globalMetrics || {}
        const activePods = pods.filter(p => p.revenue > 0 || p.teamCost > 0)

        return (
          <div key={codigo} className="bg-white rounded-2xl shadow-sm overflow-hidden">

            {/* Cabecera del mes */}
            <div className="px-5 py-3 flex items-center justify-between border-b border-gray-100">
              <div className="flex items-center gap-3">
                <span className="text-sm font-bold text-textPrimary">{label}</span>
                <span className="text-xs text-textSecondary">{activePods.length} PODs</span>
              </div>
              <div className="flex items-center gap-5 text-xs text-textSecondary">
                <span>
                  Revenue{' '}
                  <span className="font-semibold text-textPrimary ml-1">{formatUSD(global.revenue)}</span>
                </span>
                <span>
                  Margen global{' '}
                  <span className={`font-bold ml-1 ${
                    global.marginPct > 20 ? 'text-success' :
                    global.marginPct >= 0 ? 'text-warning' : 'text-danger'
                  }`}>
                    {formatPct(global.marginPct)}
                  </span>
                </span>
              </div>
            </div>

            {/* Tabla PODs */}
            <table className="w-full">
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
            </table>
          </div>
        )
      })}
    </div>
  )
}
