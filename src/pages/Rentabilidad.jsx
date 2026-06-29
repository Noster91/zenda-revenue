import { useMemo } from 'react'
import WaterfallChart from '../components/Charts/WaterfallChart'
import DataTable from '../components/DataTable'
import KPICard from '../components/KPICard'
import { formatUSD, formatPct } from '../utils/formatters'
import { POD_COLORS } from '../utils/podColors'
import resumenData from '../data/resumen_equipos.json'
import { useVentasDolarizadasData, useTeamCostoNormalizadoData } from '../hooks/useSheetData'
import useExchangeRate from '../hooks/useExchangeRate'
import useSimulationStore from '../store/useSimulationStore'
import { usePodMetrics } from '../hooks/usePodMetrics'
import { usePeriodValues } from '../hooks/useGlobalPeriod'

function Semaforo({ pct }) {
  if (pct > 20) return <span className="inline-block w-3 h-3 rounded-full bg-success" title="Margen > 20%" />
  if (pct >= 0)  return <span className="inline-block w-3 h-3 rounded-full bg-warning" title="Margen 0-20%" />
  return             <span className="inline-block w-3 h-3 rounded-full bg-danger"  title="Margen negativo" />
}

export default function Rentabilidad() {
  const { data: ventasData, source, loading } = useVentasDolarizadasData()
  const { data: teamData } = useTeamCostoNormalizadoData()
  const { rate: liveRate } = useExchangeRate()
  const { simMode, revenueAdjustments, toggleSimMode, setRevenueAdjustment, resetRevenueAdjustments } = useSimulationStore()
  const { resumenFromDesign, hasDesign, overheadUSD } = usePodMetrics()

  // Periodo global
  const { selectedMonths, periodLabel, costMultiplier } = usePeriodValues()

  // Overhead dinamico escalado por periodo
  const OVERHEAD_FIJO = (overheadUSD || 17413) * costMultiplier

  // Revenue por cliente del periodo seleccionado
  const clientRows = useMemo(() => {
    if (!ventasData || selectedMonths.length === 0) return []
    return ventasData
      .map(c => ({
        nombre: c.nombre,
        tipo: c.tipo,
        revenue: selectedMonths.reduce((s, m) => s + (c.ventaMensual?.[m] || 0), 0),
      }))
      .filter(c => c.revenue > 0)
      .sort((a, b) => b.revenue - a.revenue)
  }, [ventasData, selectedMonths])

  // Costo real del equipo desde el sheet (costoMensualARS / TC)
  const costoEquipoReal = useMemo(() => {
    if (!teamData || !teamData.length || !liveRate) return null
    const totalARS = teamData.filter(p => !p.esOverhead).reduce((s, p) => {
      const mensual = p.costoMensualARS || (p.costoAnualARS ? p.costoAnualARS / 12 : p.neto)
      return s + mensual
    }, 0)
    return Math.round(totalARS / liveRate)
  }, [teamData, liveRate])

  const costoOperativo = (costoEquipoReal ?? 28338) * costMultiplier

  // Revenue total base (Sheets si hay datos, sino fallback hardcoded)
  const hasRealRevenue = clientRows.length > 0
  const baseRevenue = hasRealRevenue
    ? clientRows.reduce((s, c) => s + c.revenue, 0)
    : 39196 * costMultiplier

  // Revenue simulado (aplica ajustes % por cliente)
  const simRevenue = useMemo(() => {
    if (!hasRealRevenue) return baseRevenue
    return clientRows.reduce((s, c) => {
      const pct = revenueAdjustments[c.nombre] ?? 100
      return s + Math.round(c.revenue * pct / 100)
    }, 0)
  }, [clientRows, revenueAdjustments, hasRealRevenue, baseRevenue])

  const activeRevenue = simMode ? simRevenue : baseRevenue
  const gop     = activeRevenue - costoOperativo
  const profits = gop - OVERHEAD_FIJO

  const baseGop     = baseRevenue - costoOperativo
  const baseProfits = baseGop - OVERHEAD_FIJO

  const gopPct      = baseRevenue ? ((gop / baseRevenue) * 100).toFixed(1) : '0'
  const overheadPct = baseRevenue ? ((OVERHEAD_FIJO / baseRevenue) * 100).toFixed(1) : '0'
  const opexPct     = baseRevenue ? (((costoOperativo + OVERHEAD_FIJO) / baseRevenue) * 100).toFixed(1) : '0'

  // POD comparativa: Diseño vs JSON base (o Enero vs Proyección si no hay diseño)
  const enero       = useMemo(() => resumenData.filter(d => d.periodo === 'Enero'), [])
  const proyeccion  = useMemo(() => resumenData.filter(d => d.periodo === 'Proyeccion'), [])
  const comparativa = useMemo(() => {
    if (hasDesign) {
      // Comparar diseño actual vs datos base (Enero JSON), escalado por periodo
      return resumenFromDesign.map(d => {
        const base = enero.find(e => e.pod.startsWith(d.id))
        return {
          pod: d.pod,
          id: d.id,
          revenueActual: (base?.revenue || 0) * costMultiplier,
          revenueProy:   d.revenue * costMultiplier,
          deltaRevenue:  (d.revenue - (base?.revenue || 0)) * costMultiplier,
          margenActual:  base?.margenPct || 0,
          margenProy:    d.margenPct,
          deltaMargen:   d.margenPct - (base?.margenPct || 0),
        }
      })
    }
    return enero.map(e => {
      const p = proyeccion.find(x => x.pod === e.pod)
      return {
        pod: e.pod,
        id: e.pod.match(/^(A\d+)/)?.[1] || 'A1',
        revenueActual: e.revenue * costMultiplier,
        revenueProy:   (p?.revenue || 0) * costMultiplier,
        deltaRevenue:  ((p?.revenue || 0) - e.revenue) * costMultiplier,
        margenActual:  e.margenPct,
        margenProy:    p?.margenPct || 0,
        deltaMargen:   (p?.margenPct || 0) - e.margenPct,
      }
    })
  }, [enero, proyeccion, hasDesign, resumenFromDesign, costMultiplier])

  const podColumns = [
    {
      key: 'pod', label: 'POD',
      render: (v, row) => (
        <div className="flex items-center gap-2">
          <Semaforo pct={row.margenActual} />
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: POD_COLORS[row.id] }} />
          <span className="font-medium text-textPrimary text-xs">{v}</span>
        </div>
      ),
    },
    { key: 'revenueActual', label: hasDesign ? 'Rev. Base' : 'Rev. Actual', align: 'right', render: v => <span className="font-semibold">{formatUSD(v)}</span> },
    { key: 'revenueProy',   label: hasDesign ? 'Rev. Diseño' : 'Rev. Proyec.', align: 'right', render: v => formatUSD(v) },
    {
      key: 'deltaRevenue', label: 'Δ Revenue', align: 'right',
      render: v => (
        <span className={`font-semibold ${v >= 0 ? 'text-success' : 'text-danger'}`}>
          {v >= 0 ? '+' : ''}{formatUSD(v)}
        </span>
      ),
    },
    {
      key: 'margenActual', label: hasDesign ? 'Margen Base' : 'Margen Act.', align: 'right',
      render: v => (
        <span className={`px-2 py-0.5 rounded-full text-xs font-bold
          ${v > 20 ? 'bg-success/10 text-success' : v >= 0 ? 'bg-warning/10 text-warning' : 'bg-danger/10 text-danger'}`}>
          {formatPct(v)}
        </span>
      ),
    },
    {
      key: 'margenProy', label: hasDesign ? 'Margen Diseño' : 'Margen Proy.', align: 'right',
      render: v => (
        <span className={`px-2 py-0.5 rounded-full text-xs font-bold
          ${v > 20 ? 'bg-success/10 text-success' : v >= 0 ? 'bg-warning/10 text-warning' : 'bg-danger/10 text-danger'}`}>
          {formatPct(v)}
        </span>
      ),
    },
    {
      key: 'deltaMargen', label: 'Δ Margen', align: 'right',
      render: v => (
        <span className={`font-semibold text-sm ${v >= 0 ? 'text-success' : 'text-danger'}`}>
          {v >= 0 ? '+' : ''}{formatPct(v)}
        </span>
      ),
    },
  ]

  // Columnas de tabla de clientes (sim mode)
  const clientSimColumns = [
    {
      key: 'nombre', label: 'Cliente',
      render: v => <span className="font-medium text-textPrimary text-sm">{v}</span>,
    },
    {
      key: 'tipo', label: 'Tipo', align: 'center',
      render: v => (
        <span className={`px-2 py-0.5 rounded-full text-xs font-bold
          ${v === 'A' ? 'bg-primary/10 text-primary' : 'bg-gray-100 text-textSecondary'}`}>
          {v}
        </span>
      ),
    },
    {
      key: 'revenue', label: 'Base (USD)', align: 'right',
      render: v => <span className="font-semibold text-textPrimary">{formatUSD(v)}</span>,
    },
    {
      key: 'nombre', id: 'slider_col', label: 'Ajuste %', align: 'center',
      render: (nombre) => {
        const pct = revenueAdjustments[nombre] ?? 100
        return (
          <div className="flex items-center gap-2 justify-center">
            <input
              type="range"
              min={50} max={150} step={5}
              value={pct}
              onChange={e => setRevenueAdjustment(nombre, e.target.value)}
              className="w-20 accent-primary"
            />
            <span className={`text-xs font-bold w-10 text-center ${pct > 100 ? 'text-success' : pct < 100 ? 'text-danger' : 'text-textSecondary'}`}>
              {pct}%
            </span>
          </div>
        )
      },
    },
    {
      key: 'revenue', id: 'sim_rev_col', label: 'Simulado', align: 'right',
      render: (v, row) => {
        const pct = revenueAdjustments[row.nombre] ?? 100
        const sim = Math.round(v * pct / 100)
        const delta = sim - v
        return (
          <div className="text-right">
            <span className={`font-semibold block ${delta > 0 ? 'text-success' : delta < 0 ? 'text-danger' : 'text-textPrimary'}`}>
              {formatUSD(sim)}
            </span>
            {delta !== 0 && (
              <span className={`text-xs ${delta > 0 ? 'text-success' : 'text-danger'}`}>
                {delta > 0 ? '+' : ''}{formatUSD(delta)}
              </span>
            )}
          </div>
        )
      },
    },
  ]

  // Columnas lectura de clientes (normal mode)
  const clientNormalColumns = [
    { key: 'nombre', label: 'Cliente', render: v => <span className="font-medium text-textPrimary text-sm">{v}</span> },
    { key: 'tipo', label: 'Tipo', align: 'center', render: v => (
      <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${v === 'A' ? 'bg-primary/10 text-primary' : 'bg-gray-100 text-textSecondary'}`}>{v}</span>
    )},
    { key: 'revenue', label: 'Revenue (USD)', align: 'right', sortable: true, render: v => <span className="font-semibold text-primary">{formatUSD(v)}</span> },
    { key: 'revenue', id: 'pct_col', label: '% del total', align: 'right', render: (v) => (
      <span className="text-xs text-textSecondary">{baseRevenue ? ((v / baseRevenue) * 100).toFixed(1) : 0}%</span>
    )},
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          {hasRealRevenue && (
            <div className="flex items-center gap-2 bg-primary/10 border border-primary/20 rounded-xl px-3 py-1.5">
              <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              <span className="text-xs font-semibold text-primary">
                {source === 'sheets' ? `Ventas reales · ${periodLabel}` : `Datos locales · ${periodLabel}`}
              </span>
            </div>
          )}
          {costoEquipoReal !== null && (
            <div className="flex items-center gap-1.5 bg-success/10 border border-success/20 rounded-xl px-3 py-1.5">
              <span className="w-2 h-2 rounded-full bg-success" />
              <span className="text-xs font-semibold text-success">
                Costos equipo · live
              </span>
            </div>
          )}
          {!hasRealRevenue && !loading && (
            <span className="text-xs text-textSecondary border border-gray-200 rounded-xl px-3 py-1.5">
              Datos de referencia — conectar Google Sheets para datos reales
            </span>
          )}
        </div>

        <button
          onClick={toggleSimMode}
          className={`text-sm font-semibold px-4 py-2 rounded-xl transition-all duration-200 ${
            simMode
              ? 'bg-primary text-white shadow-lg shadow-primary/30'
              : 'bg-white border border-gray-200 text-textPrimary hover:border-primary/40 hover:text-primary'
          }`}
        >
          {simMode ? '⚡ Simulación Activa' : '⚡ Modo Simulación'}
        </button>
      </div>

      {/* Panel simulación */}
      {simMode && (
        <div className="bg-primary/5 border border-primary/20 rounded-2xl p-5">
          <div className="flex flex-wrap items-center gap-6">
            <div>
              <p className="text-xs font-semibold text-textSecondary mb-1">Revenue Base</p>
              <p className="text-sm font-bold text-textPrimary">{formatUSD(baseRevenue)}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-textSecondary mb-1">Revenue Simulado</p>
              <p className={`text-sm font-bold ${simRevenue >= baseRevenue ? 'text-success' : 'text-danger'}`}>
                {formatUSD(simRevenue)}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold text-textSecondary mb-1">Δ Revenue</p>
              <p className={`text-sm font-bold ${simRevenue - baseRevenue >= 0 ? 'text-success' : 'text-danger'}`}>
                {simRevenue - baseRevenue >= 0 ? '+' : ''}{formatUSD(simRevenue - baseRevenue)}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold text-textSecondary mb-1">Profit Simulado</p>
              <p className={`text-sm font-bold ${profits >= 0 ? 'text-success' : 'text-danger'}`}>
                {formatUSD(profits)}
              </p>
            </div>
            <button
              onClick={resetRevenueAdjustments}
              className="ml-auto text-xs text-danger border border-danger/30 hover:bg-danger/5 rounded-lg px-3 py-1.5 font-medium transition-colors"
            >
              Resetear ajustes
            </button>
          </div>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard title="GOP" value={formatUSD(gop)} subtitle={`${gopPct}% del revenue`} color={gop >= 0 ? 'success' : 'danger'} icon="📈" />
        <KPICard title="Overhead" value={formatUSD(OVERHEAD_FIJO)} subtitle={`${overheadPct}% del revenue`} color="warning" icon="🏢" />
        <KPICard title="OPEX Total" value={formatUSD(costoOperativo + OVERHEAD_FIJO)} subtitle={`${opexPct}% del revenue`} color="default" icon="⚙️" />
        <KPICard title="Profit Neto" value={formatUSD(profits)} subtitle={simMode ? 'Resultado simulado' : 'Resultado actual'} color={profits >= 0 ? 'success' : 'danger'} icon={profits >= 0 ? '📈' : '📉'} />
      </div>

      {/* Waterfall */}
      <div className="bg-white rounded-2xl shadow-sm p-5">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-textPrimary">Cascada de Rentabilidad</h2>
          {simMode && simRevenue !== baseRevenue && (
            <span className="text-xs text-primary font-medium">⚡ Vista simulada</span>
          )}
        </div>
        <p className="text-xs text-textSecondary mb-4">Revenue → GOP → Overhead → Profits</p>
        <WaterfallChart
          revenue={activeRevenue}
          gop={gop}
          overhead={OVERHEAD_FIJO}
          profits={profits}
        />
      </div>

      {/* Revenue por cliente */}
      {(hasRealRevenue || simMode) && (
        <div className="bg-white rounded-2xl shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-textPrimary">
              Revenue por Cliente ({periodLabel})
            </h2>
            {hasRealRevenue && (
              <span className="text-xs text-textSecondary">
                {clientRows.length} clientes · {formatUSD(baseRevenue)} total
              </span>
            )}
          </div>

          {hasRealRevenue ? (
            <DataTable
              columns={simMode ? clientSimColumns : clientNormalColumns}
              data={clientRows}
              compact
            />
          ) : (
            <div className="text-center py-8 text-textSecondary text-sm">
              <p>Conectá Google Sheets (tab "Ventas Dolarizadas") para ver el desglose por cliente.</p>
            </div>
          )}

          {hasRealRevenue && (
            <div className="mt-3 pt-3 border-t border-gray-100 flex justify-between items-center">
              <span className="text-xs font-semibold text-textSecondary">Total</span>
              <div className="flex items-center gap-3">
                {simMode && simRevenue !== baseRevenue && (
                  <span className={`text-xs font-semibold ${simRevenue > baseRevenue ? 'text-success' : 'text-danger'}`}>
                    {simRevenue > baseRevenue ? '+' : ''}{formatUSD(simRevenue - baseRevenue)} simulado
                  </span>
                )}
                <span className="text-sm font-bold text-primary">{formatUSD(activeRevenue)}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Overhead breakdown */}
      <div className="bg-white rounded-2xl shadow-sm p-5">
        <h2 className="text-sm font-semibold text-textPrimary mb-4">Overhead como % del Revenue</h2>
        <div className="space-y-3">
          {[
            { label: `Costo Operativo (Equipo)${costoEquipoReal ? ' · live' : ''}`, value: costoOperativo, color: '#0A2540' },
            { label: 'Overhead (C-Level + Ops)',       value: OVERHEAD_FIJO,  color: '#F0B429' },
            { label: 'GOP (Gross Operating Profit)',   value: gop,              color: '#00C896' },
          ].map(item => {
            const pct = activeRevenue ? (item.value / activeRevenue) * 100 : 0
            return (
              <div key={item.label}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-textPrimary font-medium">{item.label}</span>
                  <span className="text-textSecondary">{formatUSD(item.value)} ({pct.toFixed(1)}%)</span>
                </div>
                <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{ width: `${Math.min(Math.abs(pct), 100)}%`, backgroundColor: item.color }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* POD comparativa */}
      <div className="bg-white rounded-2xl shadow-sm p-5">
        <div className="flex items-center gap-6 mb-4">
          <h2 className="text-sm font-semibold text-textPrimary">
            Comparativo PODs — {hasDesign ? 'Base vs. Diseño' : 'Actual vs. Proyectado'}
            {hasDesign && <span className="ml-2 text-xs text-primary font-medium">● diseño activo</span>}
          </h2>
          <div className="flex items-center gap-4 text-xs text-textSecondary">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-success inline-block" /> &gt;20%</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-warning inline-block" /> 0–20%</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-danger inline-block" /> Negativo</span>
          </div>
        </div>
        <DataTable columns={podColumns} data={comparativa} />
      </div>
    </div>
  )
}
