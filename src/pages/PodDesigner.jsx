/**
 * PodDesigner.jsx
 * Herramienta interactiva para diseñar PODs.
 * Estado compartido via usePodDesignStore → impacta Dashboard, Pods, Rentabilidad.
 */

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useTeamCostoNormalizadoData, useVentasDolarizadasData } from '../hooks/useSheetData'
import useExchangeRate from '../hooks/useExchangeRate'
import usePodDesignStore from '../store/usePodDesignStore'
import { usePodMetrics } from '../hooks/usePodMetrics'
import { formatUSD, formatPct } from '../utils/formatters'
import { POD_COLORS } from '../utils/podColors'
import useSimulationStore from '../store/useSimulationStore'
import { usePeriodValues } from '../hooks/useGlobalPeriod'
import useGlobalPeriod from '../hooks/useGlobalPeriod'
import useDataStore from '../store/useDataStore'
import { useAuth } from '../context/AuthContext'
import { listVersions, saveVersion, loadVersion, deleteVersion } from '../services/podVersionService'
import { closePeriod, reopenPeriod, listPeriodos } from '../services/periodCloseService'

// ── Constantes ────────────────────────────────────────────────────────────────
const EXTRA_COLORS = [
  '#F59E0B','#8B5CF6','#EC4899','#14B8A6','#F97316','#6366F1',
  '#EF4444','#22D3EE','#A78BFA','#FB923C','#34D399','#E879F9',
]
function getColor(id, index) {
  return POD_COLORS[id] || EXTRA_COLORS[index % EXTRA_COLORS.length]
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function margenBg(pct) {
  if (pct > 20)  return 'bg-success/10 text-success border-success/20'
  if (pct >= 0)  return 'bg-warning/10 text-warning border-warning/20'
  return 'bg-danger/10 text-danger border-danger/20'
}
function semaforo(pct) {
  if (pct > 20)  return '🟢'
  if (pct >= 0)  return '🟡'
  return '🔴'
}

// ── Fee Model: constantes y helpers ──────────────────────────────────────────
const TARGET_MARGIN_PCT = 25 // Margen neto objetivo para calcular fee bands
const FEE_TIERS = [
  { key: 'premium',  label: 'Premium',  min: 5000, color: '#3B82F6', bg: 'bg-blue-100 text-blue-700' },
  { key: 'growth',   label: 'Growth',   min: 2000, color: '#10B981', bg: 'bg-emerald-100 text-emerald-700' },
  { key: 'starter',  label: 'Starter',  min: 0,    color: '#F59E0B', bg: 'bg-amber-100 text-amber-700' },
]
function getFeeTier(fee) {
  return FEE_TIERS.find(t => fee >= t.min) || FEE_TIERS[FEE_TIERS.length - 1]
}
/** Ratio de dilución: fee del cliente vs fee promedio del POD */
function dilutionLevel(clientFee, avgFee) {
  if (avgFee === 0) return 'none'
  const ratio = clientFee / avgFee
  if (ratio >= 0.5)  return 'none'
  if (ratio >= 0.25) return 'warning'  // fee < 50% del promedio
  return 'danger'                      // fee < 25% del promedio
}
// ── Columnas de la tabla resumen ─────────────────────────────────────────────
const TABLE_COLS = [
  { key: 'id',        label: 'POD',         sortable: false },
  { key: 'nombre',    label: 'Nombre',       sortable: true },
  { key: 'nClientes', label: 'Clientes',     sortable: true,  get: p => p.clients.length },
  { key: 'revenue',   label: 'Revenue',      sortable: true },
  { key: 'teamCost',  label: 'Costo Equipo', sortable: true },
  { key: 'gop',       label: 'GOP',          sortable: true },
  { key: 'gopPct',    label: 'GOP%',         sortable: true },
  { key: 'overhead',  label: 'Overhead',     sortable: true },
  { key: 'margin',    label: 'Margen',       sortable: true },
  { key: 'marginPct', label: 'Margen%',      sortable: true },
  { key: 'estado',    label: 'Estado',       sortable: false },
]

// ── Componente principal ──────────────────────────────────────────────────────
export default function PodDesigner() {
  const { data: teamRaw, source: teamSource, loading: loadingTeam } = useTeamCostoNormalizadoData()
  const { data: ventasData, source: ventasSource, loading: loadingVentas } = useVentasDolarizadasData()
  const { rate, refresh: refreshRate, rateData } = useExchangeRate()

  // ── Auth ──────────────────────────────────────────────────────────────────
  const { session, role } = useAuth()
  const userId = session && session !== 'bypass' ? session.user?.id : null
  const isHR = role === 'hr'

  // ── Store global ──────────────────────────────────────────────────────────
  const store = usePodDesignStore()
  const {
    pods, assignments, clientAssignments, revenueOverrides,
    addPod, removePod, renamePod,
    assignMember, removeMember, setAllocation,
    assignClient, removeClient,
    setRevenueOverride, clearRevenueOverride,
    setOverheadManual, clearOverheadManual,
    resetAll, purgeOrphans, restoreConfig,
    _orphanedMembers, _orphanedClients,
    overheadManual: storeOverheadManual,
  } = store

  const { podMetrics, globalMetrics, overheadUSD, overheadFromSheet, overheadManual } = usePodMetrics()

  // ── Simulación: personas nuevas ────────────────────────────────────────────
  const { newPeople, simMode } = useSimulationStore()

  // ── Pool de datos ──────────────────────────────────────────────────────────
  const teamPool = useMemo(() => {
    const fromSheet = (teamRaw || []).filter(p => !p.esOverhead).map(p => ({
      ...p,
      costoUSD: Math.round((p.costoMensualARS || p.neto) / rate),
    }))
    // Agregar personas simuladas desde Equipo y Costos
    const fromSim = newPeople.map(p => ({
      nombre: p.nombre,
      neto: p.neto,
      costoMensualARS: p.neto,
      costoUSD: Math.round(p.neto / rate),
      _simulated: true,
    }))
    return [...fromSheet, ...fromSim]
  }, [teamRaw, rate, newPeople])

  // Periodo global
  const { selectedMonth, periodLabel, isCurrentPeriodClosed, currentPeriodClose } = usePeriodValues()
  const markPeriodClosed = useGlobalPeriod(s => s.markPeriodClosed)
  const markPeriodOpen   = useGlobalPeriod(s => s.markPeriodOpen)
  const teamMensualData  = useDataStore(s => s.teamMensualData)
  const lookerData       = useDataStore(s => s.lookerData)

  const clientPool = useMemo(() => {
    if (!ventasData || !selectedMonth) return []
    return ventasData
      .map(c => ({ nombre: c.nombre, tipo: c.tipo, revenue: c.ventaMensual?.[selectedMonth] || 0 }))
      .filter(c => c.revenue > 0)
      .sort((a, b) => b.revenue - a.revenue)
  }, [ventasData, selectedMonth])

  // ── Estado local UI ────────────────────────────────────────────────────────
  const [poolTab, setPoolTab] = useState('equipo')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState([])   // Array para multi-select
  const [editingName, setEditingName] = useState(null)
  const [editingValue, setEditingValue] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [tableSort, setTableSort] = useState({ key: 'revenue', dir: 'desc' })
  const [tableSearch, setTableSearch] = useState('')

  // ── Estado cierre de período ──────────────────────────────────────────────
  const [closingPeriod, setClosingPeriod] = useState(false)
  const [reopeningPeriod, setReopeningPeriod] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const [confirmReopen, setConfirmReopen] = useState(false)

  // ── Estado versiones ──────────────────────────────────────────────────────
  const [versions, setVersions] = useState([])
  const [showVersions, setShowVersions] = useState(false)
  const [versionName, setVersionName] = useState('')
  const [savingVersion, setSavingVersion] = useState(false)
  const [loadingVersions, setLoadingVersions] = useState(false)
  const [restoringId, setRestoringId] = useState(null)

  // ── Pools filtrados — se calculan después de memberUsage/clientUsage ──────

  // ── Uso de miembros y clientes ─────────────────────────────────────────────
  const memberUsage = useMemo(() => {
    const usage = {}
    Object.entries(assignments).forEach(([podId, members]) => {
      members.forEach(m => {
        if (!usage[m.nombre]) usage[m.nombre] = []
        usage[m.nombre].push({ podId, allocation: m.allocation })
      })
    })
    return usage
  }, [assignments])

  // Equipo disponible: excluye miembros con asignación total >= 100%
  const filteredTeam = useMemo(() =>
    teamPool
      .filter(m => {
        const totalAlloc = (memberUsage[m.nombre] || []).reduce((s, u) => s + u.allocation, 0)
        return totalAlloc < 100
      })
      .filter(m => m.nombre.toLowerCase().includes(search.toLowerCase())),
    [teamPool, memberUsage, search]
  )

  const clientUsage = useMemo(() => {
    const usage = {}
    Object.entries(clientAssignments).forEach(([podId, clients]) => {
      clients.forEach(c => { usage[c.nombre] = podId })
    })
    return usage
  }, [clientAssignments])

  // Clientes disponibles: excluye los ya asignados a algún POD
  const filteredClients = useMemo(() =>
    clientPool
      .filter(c => !clientUsage[c.nombre])
      .filter(c => c.nombre.toLowerCase().includes(search.toLowerCase())),
    [clientPool, clientUsage, search]
  )

  // ── Fee Model: computed data (aditivo, no modifica nada existente) ────────

  /** Fee band ideal por POD: cuánto debería facturar cada cliente */
  const podFeeBands = useMemo(() => {
    const bands = {}
    podMetrics.forEach(pod => {
      if (pod.members.length === 0) { bands[pod.id] = null; return }
      const totalCost = pod.teamCost + pod.overhead
      const numClients = Math.max(pod.clients.length, 1)
      const idealRevenue = totalCost / (1 - TARGET_MARGIN_PCT / 100)
      const idealFee = idealRevenue / numClients
      bands[pod.id] = {
        min: Math.round(idealFee * 0.5),
        ideal: Math.round(idealFee),
        avgFee: pod.clients.length > 0 ? Math.round(pod.clientRevenue / pod.clients.length) : 0,
      }
    })
    return bands
  }, [podMetrics])

  const sortedTableData = useMemo(() => {
    let rows = [...podMetrics]
    if (tableSearch.trim()) {
      const q = tableSearch.toLowerCase()
      rows = rows.filter(p => p.id.toLowerCase().includes(q) || (p.nombre || '').toLowerCase().includes(q))
    }
    if (!tableSort.key) return rows
    const col = TABLE_COLS.find(c => c.key === tableSort.key)
    return rows.sort((a, b) => {
      const av = col?.get ? col.get(a) : a[tableSort.key]
      const bv = col?.get ? col.get(b) : b[tableSort.key]
      if (typeof av === 'string') return tableSort.dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      return tableSort.dir === 'asc' ? (av ?? 0) - (bv ?? 0) : (bv ?? 0) - (av ?? 0)
    })
  }, [podMetrics, tableSort, tableSearch])

  /** Cuando hay clientes seleccionados: score de fit para cada POD */
  const podFitForSelected = useMemo(() => {
    const selectedClients = selected.filter(s => s.type === 'client')
    if (selectedClients.length === 0) return {}
    const totalSelectedRevenue = selectedClients.reduce((sum, c) => sum + (c.revenue || 0), 0)
    const fits = {}
    podMetrics.forEach(pod => {
      const newRevenue = pod.revenue + totalSelectedRevenue
      if (newRevenue === 0) { fits[pod.id] = 'neutral'; return }
      const newMarginPct = ((newRevenue - pod.teamCost - pod.overhead) / newRevenue) * 100
      const improvement = newMarginPct - (pod.marginPct || 0)
      if (pod.members.length === 0 && pod.clients.length === 0) fits[pod.id] = 'empty'
      else if (improvement > 2)  fits[pod.id] = 'great'
      else if (improvement >= -2) fits[pod.id] = 'good'
      else                        fits[pod.id] = 'dilutes'
    })
    return fits
  }, [selected, podMetrics])

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleSelect = useCallback((item, ctrlKey = false) => {
    setSelected(prev => {
      const isAlreadySelected = prev.some(s => s.nombre === item.nombre && s.type === item.type)
      if (ctrlKey) {
        // Ctrl+Click: toggle individual item en la selección múltiple
        if (isAlreadySelected) return prev.filter(s => !(s.nombre === item.nombre && s.type === item.type))
        // Solo permitir multi-select del mismo tipo (equipo o clientes)
        if (prev.length > 0 && prev[0].type !== item.type) return [item]
        return [...prev, item]
      }
      // Click normal: toggle único
      if (isAlreadySelected && prev.length === 1) return []
      return [item]
    })
  }, [])

  const handleAssignToPod = useCallback((podId) => {
    if (selected.length === 0) return
    selected.forEach(item => {
      if (item.type === 'team') assignMember(podId, item)
      else if (item.type === 'client') assignClient(podId, item)
    })
    setSelected([])
  }, [selected, assignMember, assignClient])

  const handleRevenueChange = useCallback((podId, value) => {
    const num = parseInt(value.replace(/\D/g, '')) || 0
    setRevenueOverride(podId, num)
  }, [setRevenueOverride])

  const startRename = useCallback((podId, currentName) => {
    setEditingName(podId)
    setEditingValue(currentName)
  }, [])

  const commitRename = useCallback(() => {
    if (!editingName) return
    const trimmed = editingValue.trim()
    if (trimmed) renamePod(editingName, trimmed)
    setEditingName(null)
    setEditingValue('')
  }, [editingName, editingValue, renamePod])

  const handleAddPod = useCallback(() => {
    addPod()
  }, [addPod])

  const handleDeletePod = useCallback((podId) => {
    removePod(podId)
    setConfirmDelete(null)
  }, [removePod])

  const handleReset = useCallback(() => {
    resetAll()
    setSelected([])
    setEditingName(null)
    setConfirmDelete(null)
  }, [resetAll])

  const handleExport = useCallback(() => {
    const data = { pods, podMetrics, globalMetrics, assignments, clientAssignments, exportedAt: new Date().toISOString() }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `zenda-pod-config-${new Date().toISOString().slice(0,10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [pods, podMetrics, globalMetrics, assignments, clientAssignments])

  // ── Version handlers ────────────────────────────────────────────────────────
  const handleLoadVersions = useCallback(async () => {
    setLoadingVersions(true)
    const list = await listVersions()
    setVersions(list)
    setLoadingVersions(false)
  }, [])

  const handleToggleVersions = useCallback(() => {
    setShowVersions(prev => {
      if (!prev) handleLoadVersions()
      return !prev
    })
  }, [handleLoadVersions])

  const handleSaveVersion = useCallback(async () => {
    if (savingVersion) return
    setSavingVersion(true)
    const name = versionName.trim() || `Versión ${new Date().toLocaleDateString('es-AR')} ${new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}`
    const config = {
      pods, assignments, clientAssignments, revenueOverrides,
      overheadManual: storeOverheadManual,
    }
    const result = await saveVersion(name, config, userId)
    if (result) {
      setVersionName('')
      await handleLoadVersions()
    }
    setSavingVersion(false)
  }, [savingVersion, versionName, pods, assignments, clientAssignments, revenueOverrides, storeOverheadManual, userId, handleLoadVersions])

  const handleRestoreVersion = useCallback(async (id) => {
    setRestoringId(id)
    const config = await loadVersion(id)
    if (config) restoreConfig(config)
    setRestoringId(null)
  }, [restoreConfig])

  const handleDeleteVersion = useCallback(async (id) => {
    await deleteVersion(id)
    await handleLoadVersions()
  }, [handleLoadVersions])

  const handleTableSort = useCallback((key) => {
    setTableSort(prev => ({
      key,
      dir: prev.key === key && prev.dir === 'desc' ? 'asc' : 'desc',
    }))
  }, [])

  // ── Handlers: cierre / apertura de período ────────────────────────────────
  const handleClosePeriod = useCallback(async () => {
    if (!selectedMonth || !userId) return
    setClosingPeriod(true)
    try {
      // Buscar el periodo_id desde Supabase
      const periodos = await listPeriodos()
      const periodo = periodos.find(p => p.codigo === selectedMonth)
      if (!periodo) throw new Error('Período no encontrado en Supabase. Corré la migración SQL primero.')

      // Armar snapshot de costos del mes
      const teamCosts = {}
      const costsSource = teamMensualData || []
      costsSource.forEach(p => {
        const costo = p.costoByMonth?.[selectedMonth] || p.costoMensualARS || 0
        if (costo > 0) teamCosts[p.nombre] = costo
      })

      // Snapshot de revenue del mes
      const revenueSnap = {}
      Object.values(clientAssignments).flat().forEach(c => {
        revenueSnap[c.nombre] = c.revenue || 0
      })

      // Estructura del mes desde lookerData
      const lookerRow = lookerData?.find(d => d.mes === selectedMonth.replace('-', ' ')) || {}
      const estructuraUsdSnap = Math.abs(lookerRow.estructura || 0)

      const snapshot = {
        podDesign: { pods, assignments, clientAssignments, revenueOverrides },
        teamCosts,
        revenue:       revenueSnap,
        overheadUsd:   globalMetrics.overhead || 0,
        estructuraUsd: estructuraUsdSnap,
        rate:          useDataStore.getState().rate,
        metrics:       { podMetrics, globalMetrics },
      }

      await closePeriod(periodo.id, snapshot, userId)
      markPeriodClosed(selectedMonth, periodo.id, periodo.label, new Date().toISOString())
      setConfirmClose(false)
    } catch (err) {
      alert(`Error al cerrar período: ${err.message}`)
    } finally {
      setClosingPeriod(false)
    }
  }, [selectedMonth, userId, teamMensualData, clientAssignments, lookerData,
      pods, assignments, revenueOverrides, podMetrics, globalMetrics, markPeriodClosed])

  const handleReopenPeriod = useCallback(async () => {
    if (!currentPeriodClose?.id || !userId) return
    setReopeningPeriod(true)
    try {
      await reopenPeriod(currentPeriodClose.id, userId)
      markPeriodOpen(selectedMonth)
      setConfirmReopen(false)
    } catch (err) {
      alert(`Error al abrir período: ${err.message}`)
    } finally {
      setReopeningPeriod(false)
    }
  }, [currentPeriodClose, userId, selectedMonth, markPeriodOpen])

  // ── Render ─────────────────────────────────────────────────────────────────
  const isTargeting = selected.length > 0
  const selectedNames = selected.map(s => s.nombre)

  return (
    <div className="space-y-4">

      {/* KPIs — solo admin */}
      {!isHR && <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: 'Revenue Total',  value: formatUSD(globalMetrics.revenue),  color: '#30b299' },
          { label: 'Costo Equipos',  value: formatUSD(globalMetrics.teamCost), color: '#6B7280' },
          { label: 'GOP',            value: formatUSD(globalMetrics.gop),      color: globalMetrics.gop >= 0 ? '#009444' : '#E53935' },
          { label: 'GOP%',           value: formatPct(globalMetrics.gopPct),   color: globalMetrics.gopPct >= 30 ? '#009444' : '#F59E0B' },
          { label: 'Margen Neto',    value: formatUSD(globalMetrics.margin),   color: globalMetrics.margin >= 0 ? '#009444' : '#E53935' },
        ].map(kpi => (
          <div key={kpi.label} className="bg-white rounded-xl shadow-sm p-3 border border-gray-100">
            <p className="text-xs text-textSecondary mb-1">{kpi.label}</p>
            <p className="text-sm font-bold" style={{ color: kpi.color }}>{kpi.value}</p>
          </div>
        ))}

        {/* Overhead editable */}
        <div className={`bg-white rounded-xl shadow-sm p-3 border ${overheadManual !== null ? 'border-warning/40 bg-warning/5' : 'border-gray-100'}`}>
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs text-textSecondary">Overhead USD</p>
            {overheadManual !== null && (
              <button onClick={clearOverheadManual}
                className="text-[9px] text-accent hover:underline">auto</button>
            )}
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-textSecondary">USD</span>
            <input
              type="text"
              value={overheadUSD.toLocaleString('es-AR')}
              onChange={e => {
                const num = parseInt(e.target.value.replace(/\D/g, '')) || 0
                setOverheadManual(num)
              }}
              className="w-full text-sm font-bold bg-transparent focus:outline-none focus:ring-0 text-right"
              style={{ color: '#F59E0B' }}
            />
          </div>
          <p className="text-[9px] text-textSecondary mt-1">
            {overheadManual !== null
              ? `Manual · Sheet: ${formatUSD(overheadFromSheet)}`
              : overheadFromSheet > 0 ? 'Auto desde sheet' : 'Sin datos de overhead'
            }
          </p>
        </div>
      </div>}

      {/* Banner período cerrado */}
      {isCurrentPeriodClosed && (
        <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-xl border border-amber-200 bg-amber-50">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-amber-500 text-base">🔒</span>
            <div>
              <p className="font-semibold text-amber-700">
                {periodLabel} — período cerrado
              </p>
              <p className="text-amber-600">
                Cerrado el {new Date(currentPeriodClose.fecha_cierre).toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric' })} · Solo lectura
              </p>
            </div>
          </div>
          {!confirmReopen ? (
            <button onClick={() => setConfirmReopen(true)}
              className="text-xs font-semibold text-amber-700 border border-amber-300 hover:bg-amber-100 rounded-lg px-3 py-1.5 flex-shrink-0 transition-colors">
              🔓 Abrir período
            </button>
          ) : (
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="text-xs text-amber-700 font-medium">¿Confirmar apertura?</span>
              <button onClick={handleReopenPeriod} disabled={reopeningPeriod}
                className="text-xs font-bold text-white bg-amber-500 hover:bg-amber-600 rounded-lg px-3 py-1.5 disabled:opacity-50 transition-colors">
                {reopeningPeriod ? '⟳' : 'Sí, abrir'}
              </button>
              <button onClick={() => setConfirmReopen(false)}
                className="text-xs text-amber-600 hover:text-amber-800">Cancelar</button>
            </div>
          )}
        </div>
      )}

      {/* Acciones */}
      <div className="flex gap-2 flex-wrap">
        <button onClick={handleToggleVersions}
          className={`px-3 py-2 text-xs font-semibold rounded-lg border-2 transition-colors ${
            showVersions ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-blue-300 text-blue-600 hover:bg-blue-50'
          }`}>
          📋 Versiones
        </button>
        <button onClick={handleAddPod}
          disabled={isCurrentPeriodClosed}
          className="px-3 py-2 text-xs font-semibold rounded-lg border-2 border-dashed border-accent text-accent hover:bg-accent/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
          + Agregar POD
        </button>
        <button onClick={handleReset}
          className="px-3 py-2 text-xs font-medium border border-gray-200 rounded-lg text-textSecondary hover:bg-gray-50 transition-colors">
          Resetear
        </button>
        <button onClick={handleExport}
          className="px-3 py-2 text-xs font-semibold rounded-lg transition-colors"
          style={{ background: '#59D7A2', color: '#0A0A0B' }}>
          Exportar
        </button>

        {/* Cerrar / Reabrir período */}
        {selectedMonth && (
          isCurrentPeriodClosed ? (
            !confirmReopen ? (
              <button onClick={() => setConfirmReopen(true)}
                className="px-3 py-2 text-xs font-semibold rounded-lg border-2 border-amber-300 text-amber-600 hover:bg-amber-50 transition-colors ml-auto">
                🔓 Reabrir {periodLabel}
              </button>
            ) : (
              <div className="flex items-center gap-2 ml-auto">
                <span className="text-xs text-amber-600 font-medium">¿Reabrir {periodLabel}?</span>
                <button onClick={handleReopenPeriod} disabled={reopeningPeriod}
                  className="px-3 py-1.5 text-xs font-bold text-white bg-amber-500 hover:bg-amber-600 rounded-lg disabled:opacity-50 transition-colors">
                  {reopeningPeriod ? '⟳ Reabriendo...' : 'Confirmar reapertura'}
                </button>
                <button onClick={() => setConfirmReopen(false)}
                  className="text-xs text-textSecondary hover:text-textPrimary">Cancelar</button>
              </div>
            )
          ) : (
            !confirmClose ? (
              <button onClick={() => setConfirmClose(true)}
                className="px-3 py-2 text-xs font-semibold rounded-lg border-2 border-rose-300 text-rose-600 hover:bg-rose-50 transition-colors ml-auto">
                🔒 Cerrar {periodLabel}
              </button>
            ) : (
              <div className="flex items-center gap-2 ml-auto">
                <span className="text-xs text-rose-600 font-medium">¿Cerrar {periodLabel} definitivamente?</span>
                <button onClick={handleClosePeriod} disabled={closingPeriod}
                  className="px-3 py-1.5 text-xs font-bold text-white bg-rose-500 hover:bg-rose-600 rounded-lg disabled:opacity-50 transition-colors">
                  {closingPeriod ? '⟳ Cerrando...' : 'Confirmar cierre'}
                </button>
                <button onClick={() => setConfirmClose(false)}
                  className="text-xs text-textSecondary hover:text-textPrimary">Cancelar</button>
              </div>
            )
          )
        )}
      </div>

      {/* Panel de versiones */}
      {showVersions && (
        <div className="bg-white rounded-2xl shadow-md border border-blue-200 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-textPrimary flex items-center gap-2">
              📋 Historial de versiones
              <span className="text-[10px] font-normal text-textSecondary">Guarda y restaura configuraciones de PODs</span>
            </h3>
            <button onClick={() => setShowVersions(false)} className="text-gray-400 hover:text-gray-600 text-sm">✕</button>
          </div>

          <div className="flex gap-2 items-center">
            <input
              type="text"
              placeholder={`Versión ${new Date().toLocaleDateString('es-AR')} ${new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}`}
              value={versionName}
              onChange={e => setVersionName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSaveVersion()}
              className="flex-1 text-xs border-2 border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-400"
            />
            <button onClick={handleSaveVersion}
              disabled={savingVersion}
              className="px-4 py-2 text-xs font-semibold rounded-lg text-white transition-colors disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, #3B82F6, #2563EB)' }}>
              {savingVersion ? '⟳ Guardando...' : '💾 Guardar versión actual'}
            </button>
          </div>

          {loadingVersions ? (
            <p className="text-xs text-textSecondary text-center py-4">⟳ Cargando versiones...</p>
          ) : versions.length === 0 ? (
            <p className="text-xs text-textSecondary text-center py-4 italic">
              No hay versiones guardadas. Guarda una para poder restaurarla después.
            </p>
          ) : (
            <div className="space-y-1.5 max-h-60 overflow-y-auto">
              {versions.map((v, i) => (
                <div key={v.id}
                  className="flex items-center justify-between gap-3 p-2.5 rounded-lg border border-gray-100 hover:border-blue-200 hover:bg-blue-50/30 transition-all group">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                      {versions.length - i}
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-textPrimary truncate">{v.name}</p>
                      <p className="text-[10px] text-textSecondary">
                        {new Date(v.created_at).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => handleRestoreVersion(v.id)}
                      disabled={restoringId === v.id}
                      className="px-2.5 py-1 text-[10px] font-bold rounded-md bg-blue-100 text-blue-700 hover:bg-blue-200 transition-colors disabled:opacity-50">
                      {restoringId === v.id ? '⟳' : '↩ Restaurar'}
                    </button>
                    <button onClick={() => handleDeleteVersion(v.id)}
                      className="px-2 py-1 text-[10px] font-bold rounded-md text-gray-400 hover:text-danger hover:bg-danger/10 transition-colors opacity-0 group-hover:opacity-100">
                      🗑
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Orphan alert */}
      {(_orphanedMembers.length > 0 || _orphanedClients.length > 0) && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-amber-500 text-base">&#9888;</span>
            <div>
              <p className="font-semibold text-amber-700">Cambios detectados en Google Sheets</p>
              <p className="text-amber-600">
                {_orphanedMembers.length > 0 && `${_orphanedMembers.length} miembro${_orphanedMembers.length > 1 ? 's' : ''} ya no aparece${_orphanedMembers.length > 1 ? 'n' : ''} en el equipo`}
                {_orphanedMembers.length > 0 && _orphanedClients.length > 0 && ' · '}
                {_orphanedClients.length > 0 && `${_orphanedClients.length} cliente${_orphanedClients.length > 1 ? 's' : ''} ya no aparece${_orphanedClients.length > 1 ? 'n' : ''} en ventas`}
                {' — '}marcados como BAJA en los PODs afectados.
              </p>
            </div>
          </div>
          <button onClick={purgeOrphans}
            className="text-xs font-semibold text-amber-700 border border-amber-300 hover:bg-amber-100 rounded-lg px-3 py-1.5 flex-shrink-0 transition-colors">
            Purgar bajas
          </button>
        </div>
      )}

      {/* TC + source badges */}
      <div className="flex items-center gap-2 text-xs text-textSecondary flex-wrap">
        <span className="w-2 h-2 rounded-full bg-accent animate-pulse inline-block" />
        {!isHR && (
          <>
            <span>
              TC: <strong className="text-textPrimary">${rate.toLocaleString('es-AR')}</strong> (blue)
              {rateData && <span className="ml-1 text-gray-400">· {rateData.compra}/{rateData.venta}</span>}
            </span>
            <button onClick={refreshRate} className="text-accent hover:underline">↻</button>
          </>
        )}
        {teamSource === 'sheets' && (
          <span className="px-2 py-0.5 bg-accent/10 text-accent rounded-full font-medium">Equipo · live</span>
        )}
        {ventasSource === 'sheets' && selectedMonth && (
          <span className="px-2 py-0.5 bg-success/10 text-success rounded-full font-medium">Ventas · {periodLabel}</span>
        )}
        <span className="px-2 py-0.5 bg-gray-100 text-textSecondary rounded-full font-medium">{pods.length} PODs</span>
      </div>

      {/* ── Pool horizontal ─────────────────────────────────────── */}
      <div style={{
        background:   'var(--w)',
        border:       'var(--bw) solid var(--bdr)',
        borderRadius: 'var(--r-card)',
        padding:      '12px 16px',
      }}>
        {/* Controles */}
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <div className="flex rounded-lg p-0.5 flex-shrink-0" style={{ background: 'rgba(89,215,162,0.08)' }}>
            {[
              { key: 'equipo',   label: 'Equipo',   count: teamPool.length },
              { key: 'clientes', label: 'Clientes', count: clientPool.length },
            ].map(tab => (
              <button key={tab.key}
                onClick={() => { setPoolTab(tab.key); setSearch(''); setSelected([]) }}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
                  poolTab === tab.key ? 'bg-white shadow-sm text-textPrimary' : 'text-textSecondary hover:text-textPrimary'
                }`}>
                {tab.label} <span className="opacity-60">({tab.count})</span>
              </button>
            ))}
          </div>

          <input
            type="text"
            placeholder={poolTab === 'equipo' ? 'Buscar persona...' : 'Buscar cliente...'}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="text-xs border-2 border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent w-44 flex-shrink-0"
          />

          <div className="ml-auto flex items-center gap-2 flex-shrink-0">
            {selected.length > 0 ? (
              <>
                <span className="px-2 py-1 rounded-full font-bold text-[10px] animate-pulse"
                  style={{ background: 'rgba(89,215,162,0.15)', color: 'var(--g-ink)' }}>
                  {selected.length} seleccionado{selected.length > 1 ? 's' : ''} → click en un POD
                </span>
                <button onClick={() => setSelected([])}
                  className="text-[10px] text-gray-400 hover:text-danger">✕</button>
              </>
            ) : (
              <p style={{ fontSize: '9px', color: 'var(--mu)', fontStyle: 'italic' }}>
                {poolTab === 'equipo'
                  ? (loadingTeam ? '⟳ Cargando...' : `${teamPool.length} personas${newPeople.length > 0 ? ` · ${newPeople.length} simuladas` : ''}`)
                  : (loadingVentas ? '⟳ Cargando...' : `${clientPool.length} clientes activos`)
                }
                {' · '}Ctrl+Click para multi-selección
              </p>
            )}
          </div>
        </div>

        {/* Chips scroll horizontal */}
        <div className="flex gap-2 overflow-x-auto" style={{ paddingBottom: '4px', scrollbarWidth: 'thin' }}>
          {poolTab === 'equipo' && filteredTeam.map(member => {
            const usage = memberUsage[member.nombre] || []
            const totalAlloc = usage.reduce((s, u) => s + u.allocation, 0)
            const isSelected = selected.some(s => s.type === 'team' && s.nombre === member.nombre)
            return (
              <div key={member.nombre}
                onClick={e => handleSelect({ type: 'team', nombre: member.nombre, costoUSD: member.costoUSD }, e.ctrlKey || e.metaKey)}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl border flex-shrink-0 transition-all cursor-pointer ${
                  isSelected
                    ? 'border-accent bg-accent/10 shadow-sm'
                    : 'border-gray-200 hover:border-accent/40 hover:bg-gray-50'
                }`}>
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0"
                  style={{ background: member._simulated ? '#8B5CF6' : isSelected ? '#30b299' : '#374151' }}>
                  {member.nombre.split(' ').map(n => n[0]).join('').slice(0, 2)}
                </div>
                <div>
                  <div className="font-semibold text-xs text-textPrimary whitespace-nowrap">
                    {member.nombre.split(' ').slice(0, 2).join(' ')}
                    {member._simulated && <span className="ml-1 px-1 rounded text-[8px] font-bold bg-purple-100 text-purple-600">SIM</span>}
                  </div>
                  {!isHR && <div className="text-[10px] text-textSecondary">{formatUSD(member.costoUSD)}</div>}
                </div>
                {usage.length > 0 && (
                  <div className="flex gap-0.5 ml-1">
                    {usage.map(u => (
                      <span key={u.podId} className="px-1.5 py-0.5 rounded text-[9px] font-semibold"
                        style={{ background: (POD_COLORS[u.podId] || '#999') + '25', color: POD_COLORS[u.podId] || '#999' }}>
                        {u.podId} {u.allocation}%
                      </span>
                    ))}
                    {totalAlloc > 100 && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-danger/10 text-danger">
                        ⚠ {totalAlloc}%
                      </span>
                    )}
                  </div>
                )}
              </div>
            )
          })}

          {poolTab === 'clientes' && filteredClients.map(client => {
            const assignedTo = clientUsage[client.nombre]
            const isSelected = selected.some(s => s.type === 'client' && s.nombre === client.nombre)
            const tier = getFeeTier(client.revenue)
            return (
              <div key={client.nombre}
                onClick={e => handleSelect({ type: 'client', nombre: client.nombre, tipo: client.tipo, revenue: client.revenue }, e.ctrlKey || e.metaKey)}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl border-2 cursor-pointer flex-shrink-0 transition-all ${
                  isSelected
                    ? 'border-accent bg-accent/10 shadow-md'
                    : assignedTo
                    ? 'border-emerald-300 bg-emerald-50'
                    : 'border-gray-200 hover:border-accent/50 hover:bg-gray-50'
                }`}>
                <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold flex-shrink-0 ${
                  client.tipo === 'A' ? 'bg-blue-100 text-blue-700' : 'bg-gray-200 text-gray-600'
                }`}>{client.tipo}</span>
                <div>
                  <div className="font-semibold text-xs text-textPrimary whitespace-nowrap">{client.nombre}</div>
                  <div className="flex items-center gap-1.5">
                    {!isHR && <span className={`px-1 py-0.5 rounded text-[8px] font-bold ${tier.bg}`}>{tier.label}</span>}
                    {!isHR && <span className="font-bold text-[10px]" style={{ color: '#059669' }}>{formatUSD(client.revenue)}</span>}
                    {assignedTo && (
                      <span className="px-1 py-0.5 rounded text-[9px] font-bold"
                        style={{ background: (POD_COLORS[assignedTo] || '#999') + '30', color: POD_COLORS[assignedTo] || '#666' }}>
                        → {assignedTo}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )
          })}

          {poolTab === 'clientes' && filteredClients.length === 0 && !loadingVentas && (
            <p className="text-xs italic py-2" style={{ color: 'var(--mu)' }}>
              {ventasData ? 'Sin resultados' : 'Conectar Google Sheets para ver clientes'}
            </p>
          )}
        </div>
      </div>

      {/* ── Grid de PODs — ancho completo ─────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {podMetrics.map((pod, podIndex) => {
            const color = getColor(pod.id, podIndex)
            const isDeleting = confirmDelete === pod.id
            const fitScore = podFitForSelected[pod.id]
            const feeBand = podFeeBands[pod.id]

            // Estilo del borde según fit del cliente seleccionado
            const hasClientSelected = selected.some(s => s.type === 'client')
            let fitBorderClass = 'border-transparent'
            let fitGlow = ''
            if (isTargeting && hasClientSelected) {
              if (fitScore === 'great')   { fitBorderClass = 'border-emerald-400'; fitGlow = '0 0 12px rgba(16,185,129,0.3)' }
              else if (fitScore === 'good')  { fitBorderClass = 'border-accent'; fitGlow = '' }
              else if (fitScore === 'dilutes') { fitBorderClass = 'border-amber-400'; fitGlow = '0 0 8px rgba(245,158,11,0.2)' }
              else if (fitScore === 'empty')  { fitBorderClass = 'border-gray-300 border-dashed' }
            } else if (isTargeting) {
              fitBorderClass = 'border-accent'
            }

            return (
              <div key={pod.id}
                onClick={() => isTargeting && handleAssignToPod(pod.id)}
                className={`bg-white rounded-2xl shadow-sm border-2 transition-all ${fitBorderClass} ${
                  isTargeting ? 'cursor-pointer hover:shadow-md hover:scale-[1.01]' : ''
                }`}
                style={fitGlow ? { boxShadow: fitGlow } : {}}>

                {/* POD Header */}
                <div className="flex items-center justify-between px-4 py-3 rounded-t-2xl"
                  style={{ background: color + '18', borderBottom: `2px solid ${color}30` }}>
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: color }} />
                    <span className="text-sm font-bold text-textPrimary flex-shrink-0">{pod.id}</span>
                    {editingName === pod.id ? (
                      <input
                        autoFocus
                        type="text"
                        value={editingValue}
                        onChange={e => setEditingValue(e.target.value)}
                        onBlur={commitRename}
                        onKeyDown={e => {
                          if (e.key === 'Enter') commitRename()
                          if (e.key === 'Escape') { setEditingName(null); setEditingValue('') }
                        }}
                        onClick={e => e.stopPropagation()}
                        className="text-xs bg-white border border-accent rounded px-1.5 py-0.5 focus:outline-none focus:ring-2 focus:ring-accent/30 min-w-0 flex-1"
                      />
                    ) : (
                      <span
                        onClick={e => { e.stopPropagation(); startRename(pod.id, pod.nombre) }}
                        className={`text-xs truncate cursor-text hover:text-textPrimary hover:underline decoration-dashed underline-offset-2 min-w-0 ${pod.nombre ? 'text-textSecondary' : 'text-gray-300 italic'}`}
                        title="Click para renombrar">
                        {pod.nombre || 'Sin nombre — asigna un cliente'}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {!isHR && <span className="text-lg">{semaforo(pod.marginPct)}</span>}
                    {isDeleting ? (
                      <div className="flex items-center gap-1 ml-1" onClick={e => e.stopPropagation()}>
                        <button onClick={() => handleDeletePod(pod.id)}
                          className="text-[10px] font-bold text-white bg-danger rounded px-1.5 py-0.5 hover:bg-danger/80">Sí</button>
                        <button onClick={() => setConfirmDelete(null)}
                          className="text-[10px] font-bold text-textSecondary bg-gray-100 rounded px-1.5 py-0.5 hover:bg-gray-200">No</button>
                      </div>
                    ) : (
                      <button
                        onClick={e => { e.stopPropagation(); setConfirmDelete(pod.id) }}
                        className="text-gray-300 hover:text-danger transition-colors ml-1 text-sm"
                        title="Eliminar POD">✕</button>
                    )}
                  </div>
                </div>

                <div className="p-4 space-y-3">
                  {/* Revenue — solo admin */}
                  {!isHR && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-textSecondary w-20 flex-shrink-0">Revenue</span>
                    <div className="flex-1 relative">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-textSecondary">USD</span>
                      <input type="text"
                        value={pod.revenue.toLocaleString('es-AR')}
                        onChange={e => handleRevenueChange(pod.id, e.target.value)}
                        onClick={e => e.stopPropagation()}
                        className="w-full text-right text-xs font-semibold border border-gray-200 rounded-lg px-2 py-1.5 pl-8 focus:outline-none focus:ring-2 focus:ring-accent/30" />
                    </div>
                    {pod.hasOverride && (
                      <button onClick={e => { e.stopPropagation(); clearRevenueOverride(pod.id) }}
                        className="text-[9px] text-accent hover:underline flex-shrink-0">auto</button>
                    )}
                  </div>
                  )}

                  {/* Metricas — solo admin */}
                  {!isHR && (
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="bg-gray-50 rounded-lg p-2">
                      <p className="text-[10px] text-textSecondary">Costo</p>
                      <p className="text-xs font-bold text-textPrimary">{formatUSD(pod.teamCost)}</p>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-2">
                      <p className="text-[10px] text-textSecondary">GOP%</p>
                      <p className={`text-xs font-bold ${pod.gopPct >= 0 ? 'text-success' : 'text-danger'}`}>{formatPct(pod.gopPct)}</p>
                    </div>
                    <div className={`rounded-lg p-2 border ${margenBg(pod.marginPct)}`}>
                      <p className="text-[10px] opacity-70">Margen%</p>
                      <p className="text-xs font-bold">{formatPct(pod.marginPct)}</p>
                    </div>
                  </div>
                  )}

                  {!isHR && (
                  <div className="w-full bg-gray-100 rounded-full h-1.5">
                    <div className="h-1.5 rounded-full transition-all duration-500"
                      style={{
                        width: `${Math.min(Math.max(pod.marginPct + 40, 0), 100)}%`,
                        background: pod.marginPct > 20 ? '#009444' : pod.marginPct >= 0 ? '#F59E0B' : '#E53935',
                      }} />
                  </div>
                  )}

                  {/* Fee band ideal — solo admin */}
                  {!isHR && feeBand && pod.members.length > 0 && (
                    <div className="flex items-center justify-between text-[10px] bg-blue-50 rounded-lg px-2.5 py-1.5 border border-blue-100">
                      <div className="flex items-center gap-1">
                        <span className="text-blue-400">💎</span>
                        <span className="text-blue-600 font-medium">Fee ideal/cliente</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-blue-400 font-medium">{formatUSD(feeBand.min)}</span>
                        <span className="text-blue-300">—</span>
                        <span className="text-blue-700 font-bold">{formatUSD(feeBand.ideal)}</span>
                        {feeBand.avgFee > 0 && (
                          <span className={`ml-1 px-1 py-0.5 rounded font-bold text-[9px] ${
                            feeBand.avgFee >= feeBand.ideal * 0.8
                              ? 'bg-emerald-100 text-emerald-700'
                              : feeBand.avgFee >= feeBand.min
                                ? 'bg-amber-100 text-amber-700'
                                : 'bg-red-100 text-red-700'
                          }`}>
                            avg {formatUSD(feeBand.avgFee)}
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Fit indicator — solo admin */}
                  {!isHR && isTargeting && hasClientSelected && fitScore && fitScore !== 'empty' && (
                    <div className={`flex items-center gap-1.5 text-[10px] rounded-lg px-2.5 py-1.5 font-semibold ${
                      fitScore === 'great'  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                      fitScore === 'good'   ? 'bg-blue-50 text-blue-600 border border-blue-200' :
                                              'bg-amber-50 text-amber-700 border border-amber-200'
                    }`}>
                      <span>{fitScore === 'great' ? '✅' : fitScore === 'good' ? '👍' : '⚠️'}</span>
                      <span>
                        {fitScore === 'great'  && 'Excelente fit — mejora el margen'}
                        {fitScore === 'good'   && 'Buen fit — margen estable'}
                        {fitScore === 'dilutes' && 'Cuidado — diluye el margen del POD'}
                      </span>
                    </div>
                  )}

                  {/* Clientes asignados */}
                  {pod.clients.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-[10px] font-semibold text-textSecondary uppercase tracking-wide">Clientes ({pod.clients.length})</p>
                      {pod.clients.map(client => {
                        const dilution = feeBand ? dilutionLevel(client.revenue, feeBand.avgFee) : 'none'
                        return (
                        <div key={client.nombre}
                          className={`flex items-center gap-2 text-[11px] ${
                            client._orphaned ? 'opacity-50 bg-danger/5 rounded px-1 -mx-1'
                            : (!isHR && dilution === 'danger') ? 'bg-red-50 rounded px-1 -mx-1'
                            : (!isHR && dilution === 'warning') ? 'bg-amber-50/50 rounded px-1 -mx-1'
                            : ''
                          }`}
                          onClick={e => e.stopPropagation()}>
                          {client._orphaned && (
                            <span className="px-1 py-0.5 rounded text-[8px] font-bold bg-danger/15 text-danger flex-shrink-0" title="Ya no aparece en Ventas Dolarizadas">BAJA</span>
                          )}
                          {!isHR && !client._orphaned && dilution !== 'none' && (
                            <span className={`flex-shrink-0 text-[10px] ${
                              dilution === 'danger' ? 'text-red-500' : 'text-amber-500'
                            }`} title={dilution === 'danger'
                              ? `Fee muy bajo: ${formatUSD(client.revenue)} vs avg ${formatUSD(feeBand?.avgFee || 0)}`
                              : `Fee bajo: ${formatUSD(client.revenue)} vs avg ${formatUSD(feeBand?.avgFee || 0)}`
                            }>
                              {dilution === 'danger' ? '🔻' : '▽'}
                            </span>
                          )}
                          <span className={`px-1 py-0.5 rounded text-[9px] font-bold flex-shrink-0 ${
                            client.tipo === 'A' ? 'bg-primary/10 text-primary' : 'bg-gray-100 text-textSecondary'
                          }`}>{client.tipo}</span>
                          <span className={`truncate flex-1 min-w-0 ${client._orphaned ? 'line-through text-textSecondary' : 'text-textPrimary'}`}>{client.nombre}</span>
                          {!isHR && <span className="text-primary font-semibold flex-shrink-0">{formatUSD(client.revenue)}</span>}
                          <button onClick={() => removeClient(pod.id, client.nombre)}
                            className="text-gray-300 hover:text-danger transition-colors flex-shrink-0">✕</button>
                        </div>
                        )
                      })}
                    </div>
                  )}

                  {/* Equipo asignado */}
                  <div className="space-y-1.5">
                    <p className="text-[10px] font-semibold text-textSecondary uppercase tracking-wide">Equipo ({pod.members.length})</p>
                    {pod.members.length === 0 && pod.clients.length === 0 && (
                      <p className="text-[11px] text-textSecondary italic text-center py-2">
                        {isTargeting ? '→ Click para asignar aquí' : 'Sin asignaciones'}
                      </p>
                    )}
                    {pod.members.map(member => {
                      // Calcular max disponible para el slider
                      const usedElsewhere = Object.entries(assignments)
                        .filter(([pid]) => pid !== pod.id)
                        .reduce((sum, [, members]) => {
                          const m = members.find(m => m.nombre === member.nombre)
                          return sum + (m ? m.allocation : 0)
                        }, 0)
                      const maxSlider = Math.max(10, 100 - usedElsewhere)
                      const totalAlloc = usedElsewhere + member.allocation

                      return (
                      <div key={member.nombre}
                        className={`flex items-center gap-2 ${member._orphaned ? 'opacity-50 bg-danger/5 rounded px-1 -mx-1' : ''}`}
                        onClick={e => e.stopPropagation()}>
                        {member._orphaned ? (
                          <span className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0 bg-danger"
                            title="Ya no aparece en Team Costo Normalizado">!</span>
                        ) : (
                          <div className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0"
                            style={{ background: color }}>
                            {member.nombre.split(' ').map(n => n[0]).join('').slice(0,2)}
                          </div>
                        )}
                        <span className={`text-[11px] truncate flex-1 min-w-0 ${member._orphaned ? 'line-through text-textSecondary' : 'text-textPrimary'}`}>
                          {member.nombre.split(' ').slice(0,2).join(' ')}
                        </span>
                        {!member._orphaned && (
                          <>
                            <input type="range" min={10} max={maxSlider} step={5}
                              value={member.allocation}
                              onChange={e => setAllocation(pod.id, member.nombre, e.target.value)}
                              className="w-14 accent-accent"
                              title={`Disponible: ${maxSlider}% (${usedElsewhere}% asignado en otros PODs)`} />
                            <span className={`text-[10px] font-bold w-8 text-right flex-shrink-0 ${
                              totalAlloc >= 100 ? 'text-danger' : ''
                            }`} style={totalAlloc < 100 ? { color } : {}}>
                              {member.allocation}%
                            </span>
                            {!isHR && (
                            <span className="text-[10px] text-textSecondary whitespace-nowrap flex-shrink-0 w-16 text-right">
                              {formatUSD(Math.round((member.costoUSD || 0) * member.allocation / 100))}
                            </span>
                            )}
                          </>
                        )}
                        {member._orphaned && (
                          <span className="text-[8px] font-bold text-danger flex-shrink-0">BAJA</span>
                        )}
                        <button onClick={() => removeMember(pod.id, member.nombre)}
                          className="text-gray-300 hover:text-danger transition-colors flex-shrink-0 text-xs">✕</button>
                      </div>
                      )
                    })}
                  </div>

                  {!isHR && (pod.members.length > 0 || pod.clients.length > 0) && (
                    <div className="text-[10px] text-textSecondary border-t border-gray-100 pt-2 space-y-0.5">
                      {pod.clients.length > 0 && (
                        <div className="flex justify-between">
                          <span>Revenue clientes</span>
                          <span className="font-semibold text-primary">{formatUSD(pod.clientRevenue)}</span>
                        </div>
                      )}
                      <div className="flex justify-between"><span>Costo equipo</span><span className="font-semibold">{formatUSD(pod.teamCost)}</span></div>
                      <div className="flex justify-between"><span>Overhead (proporcional)</span><span className="font-semibold">{formatUSD(pod.overhead)}</span></div>
                      <div className="flex justify-between font-bold text-textPrimary border-t border-gray-100 pt-0.5 mt-0.5">
                        <span>Margen neto</span>
                        <span className={pod.margin >= 0 ? 'text-success' : 'text-danger'}>{formatUSD(pod.margin)}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )
          })}

          <button onClick={handleAddPod}
            className="rounded-2xl border-2 border-dashed border-gray-300 hover:border-accent flex flex-col items-center justify-center gap-2 py-12 text-textSecondary hover:text-accent transition-colors cursor-pointer group">
            <span className="text-3xl group-hover:scale-110 transition-transform">+</span>
            <span className="text-xs font-semibold">Agregar POD</span>
          </button>
      </div>

      {/* Tabla resumen — solo admin */}
      {!isHR && <div className="bg-white rounded-2xl shadow-sm p-5 overflow-x-auto">
        <div className="flex items-center justify-between mb-4 gap-4">
          <h2 className="text-sm font-bold text-textPrimary whitespace-nowrap">Resumen comparativo por POD</h2>
          <input
            type="text"
            placeholder="Filtrar por POD o nombre..."
            value={tableSearch}
            onChange={e => setTableSearch(e.target.value)}
            className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent w-56"
          />
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-100">
              {TABLE_COLS.map(col => (
                <th key={col.key} className="pb-2 pr-4 text-left whitespace-nowrap">
                  {col.sortable ? (
                    <button
                      onClick={() => handleTableSort(col.key)}
                      className="flex items-center gap-1 font-semibold transition-colors hover:text-textPrimary"
                      style={{ color: tableSort.key === col.key ? 'var(--k)' : 'var(--mu)' }}>
                      {col.label}
                      <span style={{ fontSize: '9px', opacity: tableSort.key === col.key ? 1 : 0.4 }}>
                        {tableSort.key === col.key ? (tableSort.dir === 'asc' ? '↑' : '↓') : '↕'}
                      </span>
                    </button>
                  ) : (
                    <span className="font-semibold text-textSecondary">{col.label}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedTableData.map((pod, i) => (
              <tr key={pod.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                <td className="py-2 pr-4">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: getColor(pod.id, podMetrics.findIndex(p => p.id === pod.id)) }} />
                    <span className="font-semibold text-textPrimary">{pod.id}</span>
                  </div>
                </td>
                <td className="py-2 pr-4 text-textSecondary max-w-[120px] truncate">{pod.nombre}</td>
                <td className="py-2 pr-4 text-textSecondary">{pod.clients.length || '—'}</td>
                <td className="py-2 pr-4 font-semibold">{formatUSD(pod.revenue)}</td>
                <td className="py-2 pr-4">{formatUSD(pod.teamCost)}</td>
                <td className={`py-2 pr-4 font-semibold ${pod.gop >= 0 ? 'text-success' : 'text-danger'}`}>{formatUSD(pod.gop)}</td>
                <td className="py-2 pr-4"><span className={`px-1.5 py-0.5 rounded-full font-bold text-[10px] ${margenBg(pod.gopPct)}`}>{formatPct(pod.gopPct)}</span></td>
                <td className="py-2 pr-4 text-warning">{formatUSD(pod.overhead)}</td>
                <td className={`py-2 pr-4 font-bold ${pod.margin >= 0 ? 'text-success' : 'text-danger'}`}>{formatUSD(pod.margin)}</td>
                <td className="py-2 pr-4"><span className={`px-1.5 py-0.5 rounded-full font-bold text-[10px] border ${margenBg(pod.marginPct)}`}>{formatPct(pod.marginPct)}</span></td>
                <td className="py-2 text-base">{semaforo(pod.marginPct)}</td>
              </tr>
            ))}
            {sortedTableData.length === 0 && (
              <tr>
                <td colSpan={11} className="py-4 text-center text-xs text-textSecondary italic">Sin resultados</td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-200 font-bold">
              <td className="pt-3 pr-4 text-textPrimary">TOTAL</td>
              <td className="pt-3 pr-4 text-textSecondary">{pods.length} PODs</td>
              <td className="pt-3 pr-4 text-textSecondary">{Object.values(clientAssignments).flat().length}</td>
              <td className="pt-3 pr-4">{formatUSD(globalMetrics.revenue)}</td>
              <td className="pt-3 pr-4">{formatUSD(globalMetrics.teamCost)}</td>
              <td className={`pt-3 pr-4 ${globalMetrics.gop >= 0 ? 'text-success' : 'text-danger'}`}>{formatUSD(globalMetrics.gop)}</td>
              <td className="pt-3 pr-4"><span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${margenBg(globalMetrics.gopPct)}`}>{formatPct(globalMetrics.gopPct)}</span></td>
              <td className="pt-3 pr-4 text-warning">{formatUSD(globalMetrics.overhead)}</td>
              <td className={`pt-3 pr-4 ${globalMetrics.margin >= 0 ? 'text-success' : 'text-danger'}`}>{formatUSD(globalMetrics.margin)}</td>
              <td className="pt-3 pr-4"><span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold border ${margenBg(globalMetrics.marginPct)}`}>{formatPct(globalMetrics.marginPct)}</span></td>
              <td className="pt-3 text-base">{semaforo(globalMetrics.marginPct)}</td>
            </tr>
          </tfoot>
        </table>
      </div>}

    </div>
  )
}
