/**
 * useDataOrchestrator.js
 * Orquesta la coordinacion entre datos de costos, revenue y diseno de PODs.
 *
 * Se ejecuta una sola vez en el Layout. Responsabilidades:
 * 1. Inicializa el data store (fetch inicial + auto-refresh)
 * 2. Sincroniza las asignaciones del POD designer cuando cambian los datos
 *    (nuevos costos de equipo, cambios de revenue, rotacion de personal)
 */
import { useEffect } from 'react'
import useDataStore from '../store/useDataStore'
import usePodDesignStore from '../store/usePodDesignStore'
import useGlobalPeriod from './useGlobalPeriod'
import { isSupabaseConfigured } from '../lib/supabase'
import { listPeriodos, loadClosedPeriod } from '../services/periodCloseService'

export default function useDataOrchestrator() {
  const initialize           = useDataStore(s => s.initialize)
  const teamData             = useDataStore(s => s.teamData)
  const teamMensualData      = useDataStore(s => s.teamMensualData)
  const setTeamDataForMonth  = useDataStore(s => s.setTeamDataForMonth)
  const ventasData           = useDataStore(s => s.ventasData)
  const rate                 = useDataStore(s => s.rate)
  const teamSource           = useDataStore(s => s.teamSource)
  const ventasSource         = useDataStore(s => s.ventasSource)

  const syncWithLiveData   = usePodDesignStore(s => s.syncWithLiveData)
  const loadFromSupabase   = usePodDesignStore(s => s.loadFromSupabase)
  const restoreConfig      = usePodDesignStore(s => s.restoreConfig)
  const selectedMonth      = useGlobalPeriod(s => s.selectedMonth)
  const setAvailableMonths = useGlobalPeriod(s => s.setAvailableMonths)
  const closedPeriods      = useGlobalPeriod(s => s.closedPeriods)
  const setClosedPeriods   = useGlobalPeriod(s => s.setClosedPeriods)

  // 1. Initialize data store on mount
  useEffect(() => {
    initialize()
  }, [initialize])

  // 1d. Cuando llegan los costos mensualizados o cambia el período, derivar teamData para ese mes
  useEffect(() => {
    if (teamMensualData && selectedMonth) {
      setTeamDataForMonth(selectedMonth)
    }
  }, [teamMensualData, selectedMonth, setTeamDataForMonth])

  // 1c. Load POD config from Supabase on mount (overrides localStorage)
  useEffect(() => {
    if (isSupabaseConfigured) {
      loadFromSupabase()
    }
  }, [loadFromSupabase])

  // 1e. Cargar estado de períodos cerrados desde Supabase
  useEffect(() => {
    if (!isSupabaseConfigured) return
    listPeriodos()
      .then(periodos => setClosedPeriods(periodos))
      .catch(() => {}) // silencioso si la tabla aún no existe
  }, [setClosedPeriods])

  // 1f. Cuando se navega a un período cerrado, cargar su snapshot
  useEffect(() => {
    if (!selectedMonth || !isSupabaseConfigured) return
    const closed = closedPeriods[selectedMonth]
    if (!closed) return

    loadClosedPeriod(closed.id)
      .then(snap => {
        if (!snap) return
        // Restaurar el diseño de PODs del snapshot
        if (snap.pod_design) {
          restoreConfig(snap.pod_design)
        }
        // Reconstituir teamData desde el snapshot de costos
        const teamCostsSnap = snap.team_costs || {}
        const rate = snap.rate || useDataStore.getState().rate
        const derivedTeam = Object.entries(teamCostsSnap).map(([nombre, costoARS]) => ({
          nombre,
          costoMensualARS: costoARS,
          neto: costoARS,
        }))
        if (derivedTeam.length > 0) {
          useDataStore.setState({ teamData: derivedTeam, teamSource: 'snapshot' })
        }
      })
      .catch(() => {})
  }, [selectedMonth, closedPeriods, restoreConfig])

  // 1b. Feed available months to period store
  useEffect(() => {
    if (ventasData && ventasData.length > 0) {
      const meses = ventasData[0]?.meses || []
      if (meses.length > 0) setAvailableMonths(meses)
    }
  }, [ventasData, setAvailableMonths])

  // 2. Sync POD design store whenever data or selected period changes
  useEffect(() => {
    // Only sync if we have live data (not just local fallbacks)
    if (teamSource !== 'sheets' && ventasSource !== 'sheets') return
    if (!teamData || !rate) return

    // Build team pool: operativos + C-Level operativos (asignables a PODs)
    const teamPool = teamData
      .filter(p => !p.esOverhead || p.cLevelOperativo)
      .map(p => ({
        nombre: p.nombre,
        costoUSD: Math.round((p.costoMensualARS || p.neto || 0) / rate),
      }))

    // Build client pool using selected month from period store
    let clientPool = []
    if (ventasData && selectedMonth) {
      clientPool = ventasData
        .map(c => ({
          nombre: c.nombre,
          tipo: c.tipo,
          revenue: c.ventaMensual?.[selectedMonth] || 0,
        }))
        .filter(c => c.revenue > 0)
    }

    syncWithLiveData(teamPool, clientPool)
  }, [teamData, ventasData, rate, teamSource, ventasSource, syncWithLiveData, selectedMonth])

  // Cleanup auto-refresh on unmount
  useEffect(() => {
    return () => {
      useDataStore.getState().stopAutoRefresh()
    }
  }, [])
}
