/**
 * useDataStore.js
 * Central Zustand store — fuente unica de verdad para TODOS los datos live.
 *
 * Reemplaza los fetches independientes de useSheetData / useExchangeRate.
 * Auto-refresh cada 5 minutos para mantenerse sincronizado con Google Sheets
 * y el tipo de cambio blue.
 */
import { create } from 'zustand'
import {
  isConfigured,
  isLookerConfigured,
  fetchTeamCostoNormalizado,
  fetchVentasDolarizadas,
  fetchDatosLooker,
  fetchCostosMensualizados,
  TAB_TEAM,
  TAB_VENTAS,
  TAB_DATOS_LOOKER,
  TAB_COSTOS_MENSUALIZADOS,
} from '../services/sheetsService'
import {
  fetchDolarBlue,
  getCachedRate,
  setCachedRate,
  clearRateCache,
} from '../services/exchangeRate'
import { supabase } from '../lib/supabase'
import localTeam from '../data/team_cost.json'

// ── Constantes ───────────────────────────────────────────────────────────────
const REFRESH_MS = 5 * 60 * 1000 // 5 minutos
const RATE_FALLBACK = 1320
const MES_ABR = [
  'ene','feb','mar','abr','may','jun','jul','ago','sept','oct','nov','dic',
]

/** Encuentra la columna del mes actual en el sheet (ej: "abr-26") */
function detectCurrentMonth(meses) {
  const now = new Date()
  for (let offset = 0; offset <= 12; offset++) {
    const d = new Date(now.getFullYear(), now.getMonth() - offset, 1)
    const col = `${MES_ABR[d.getMonth()]}-${String(d.getFullYear()).slice(2)}`
    if (meses.includes(col)) return col
  }
  return meses[0] || null
}

// ── Store ────────────────────────────────────────────────────────────────────
const useDataStore = create((set, get) => ({
  // ── Team Costo Normalizado ────────────────────────────────────────────────
  teamData: localTeam,
  teamSource: 'local',
  teamLoading: false,
  teamError: null,
  teamLastFetch: null,

  // ── Ventas Dolarizadas ────────────────────────────────────────────────────
  ventasData: null,
  ventasSource: 'local',
  ventasLoading: false,
  ventasError: null,
  ventasLastFetch: null,

  // ── Costos Mensualizados (costo real por mes 2026) ───────────────────────
  teamMensualData: null,
  teamMensualSource: 'none',
  teamMensualLoading: false,
  teamMensualError: null,
  teamMensualLastFetch: null,

  // ── Datos Looker (P&L mensual) ────────────────────────────────────────────
  lookerData: null,
  lookerSource: 'local',
  lookerLoading: false,
  lookerError: null,
  lookerLastFetch: null,

  // ── Tipo de Cambio ────────────────────────────────────────────────────────
  rate: RATE_FALLBACK,
  rateData: null,
  rateLoading: false,
  rateError: null,
  rateLastFetch: null,

  // ── Auto-refresh ──────────────────────────────────────────────────────────
  autoRefreshEnabled: true,
  _intervalId: null,
  _initialized: false,

  // ── Fetch: Team ───────────────────────────────────────────────────────────
  fetchTeam: async () => {
    if (!isConfigured()) return
    set({ teamLoading: true, teamError: null })
    try {
      const data = await fetchTeamCostoNormalizado(TAB_TEAM)
      if (data && data.length > 0) {
        set({ teamData: data, teamSource: 'sheets', teamLastFetch: Date.now() })
      }
    } catch (err) {
      set({ teamError: err.message })
    } finally {
      set({ teamLoading: false })
    }
  },

  // ── Fetch: Costos Mensualizados ───────────────────────────────────────────
  fetchTeamMensual: async () => {
    if (!isConfigured()) return
    set({ teamMensualLoading: true, teamMensualError: null })
    try {
      const data = await fetchCostosMensualizados(TAB_COSTOS_MENSUALIZADOS)
      if (data && data.length > 0) {
        set({ teamMensualData: data, teamMensualSource: 'sheets', teamMensualLastFetch: Date.now() })
      }
    } catch (err) {
      set({ teamMensualError: err.message })
    } finally {
      set({ teamMensualLoading: false })
    }
  },

  // Deriva teamData para un mes específico a partir de teamMensualData.
  // Mantiene la misma forma que teamData estático para que todo downstream funcione sin cambios.
  setTeamDataForMonth: (month) => {
    const { teamMensualData } = get()
    if (!teamMensualData || !month) return
    const derived = teamMensualData
      .map(p => {
        const costoMensualARS = p.costoByMonth[month] || 0
        if (costoMensualARS === 0) return null
        return {
          nombre: p.nombre,
          costoMensualARS,
          costoAnualARS: costoMensualARS * 12,
          neto: costoMensualARS,
          ...(p.esOverhead && { esOverhead: true, categoria: p.categoria || p.nombre }),
          ...(p.cLevelOperativo && { cLevelOperativo: true }),
        }
      })
      .filter(Boolean)
    if (derived.length > 0) {
      set({ teamData: derived, teamSource: 'sheets' })
    }
  },

  // ── Fetch: Ventas ─────────────────────────────────────────────────────────
  fetchVentas: async () => {
    if (!isConfigured()) return
    set({ ventasLoading: true, ventasError: null })
    try {
      const data = await fetchVentasDolarizadas(TAB_VENTAS)
      if (data && data.length > 0) {
        set({ ventasData: data, ventasSource: 'sheets', ventasLastFetch: Date.now() })
      }
    } catch (err) {
      set({ ventasError: err.message })
    } finally {
      set({ ventasLoading: false })
    }
  },

  // ── Fetch: Datos Looker ───────────────────────────────────────────────────
  // Camino 1: Google Sheets directo con API key (sheet público).
  // Camino 2: Supabase Edge Function como fallback (sheet privado).
  fetchLooker: async () => {
    set({ lookerLoading: true, lookerError: null })
    try {
      if (isLookerConfigured()) {
        try {
          const data = await fetchDatosLooker(TAB_DATOS_LOOKER)
          if (data && data.length > 0) {
            set({ lookerData: data, lookerSource: 'sheets', lookerLastFetch: Date.now() })
            return
          }
        } catch {
          // Sheet privado o API key sin acceso — intenta Edge Function
        }
      }
      if (supabase) {
        const { data, error } = await supabase.functions.invoke('datos-looker')
        if (error) throw error
        if (data && Array.isArray(data) && data.length > 0) {
          set({ lookerData: data, lookerSource: 'sheets', lookerLastFetch: Date.now() })
        }
      }
    } catch (err) {
      set({ lookerError: err.message })
    } finally {
      set({ lookerLoading: false })
    }
  },

  // ── Fetch: Exchange Rate ──────────────────────────────────────────────────
  fetchRate: async (force = false) => {
    if (force) clearRateCache()
    const cached = getCachedRate()
    if (cached && !force) {
      set({ rate: cached.promedio, rateData: cached, rateLastFetch: cached.ts })
      return
    }
    set({ rateLoading: true, rateError: null })
    try {
      const data = await fetchDolarBlue()
      setCachedRate(data)
      set({ rate: data.promedio, rateData: data, rateLastFetch: Date.now() })
    } catch (err) {
      set({ rateError: err.message })
    } finally {
      set({ rateLoading: false })
    }
  },

  // ── Refresh All ───────────────────────────────────────────────────────────
  // fetchTeam() intencionalmente excluido: el auto-refresh NO debe pisar el
  // teamData derivado por setTeamDataForMonth. Tras fetchTeamMensual(), el
  // efecto del orquestador re-deriva para el selectedMonth activo.
  refreshAll: async () => {
    const { fetchTeamMensual, fetchVentas, fetchRate, fetchLooker } = get()
    await Promise.allSettled([fetchTeamMensual(), fetchVentas(), fetchRate(true), fetchLooker()])
  },

  // ── Initialize (called once from Layout) ──────────────────────────────────
  initialize: async () => {
    if (get()._initialized) return
    set({ _initialized: true })
    const { fetchTeam, fetchTeamMensual, fetchVentas, fetchRate, fetchLooker, startAutoRefresh } = get()
    await Promise.allSettled([fetchTeam(), fetchTeamMensual(), fetchVentas(), fetchRate(), fetchLooker()])
    startAutoRefresh()
  },

  // ── Auto-refresh control ──────────────────────────────────────────────────
  startAutoRefresh: () => {
    const { _intervalId, refreshAll } = get()
    if (_intervalId) return
    const id = setInterval(() => refreshAll(), REFRESH_MS)
    set({ _intervalId: id, autoRefreshEnabled: true })
  },

  stopAutoRefresh: () => {
    const { _intervalId } = get()
    if (_intervalId) {
      clearInterval(_intervalId)
      set({ _intervalId: null, autoRefreshEnabled: false })
    }
  },

  toggleAutoRefresh: () => {
    const { autoRefreshEnabled, startAutoRefresh, stopAutoRefresh } = get()
    if (autoRefreshEnabled) stopAutoRefresh()
    else startAutoRefresh()
  },

  // ── Derived helpers (no son reactivos — usar con useMemo en componentes) ──
  /** Mes actual detectado del sheet de ventas */
  getCurrentMonth: () => {
    const { ventasData } = get()
    const meses = ventasData?.[0]?.meses || []
    return detectCurrentMonth(meses)
  },

  /** Costo overhead USD (C-Level + Ops) computado desde el sheet */
  getOverheadUSD: () => {
    const { teamData, rate } = get()
    if (!teamData || !rate) return 0
    return Math.round(
      teamData
        .filter(p => p.esOverhead)
        .reduce((sum, p) => sum + (p.costoMensualARS || p.neto || 0), 0) / rate
    )
  },

  /** Costo operativo USD (equipo sin overhead) */
  getOperativeCostUSD: () => {
    const { teamData, rate } = get()
    if (!teamData || !rate) return 0
    return Math.round(
      teamData
        .filter(p => !p.esOverhead)
        .reduce((sum, p) => sum + (p.costoMensualARS || p.neto || 0), 0) / rate
    )
  },

  /** Revenue total del mes actual */
  getTotalRevenue: () => {
    const { ventasData } = get()
    const month = get().getCurrentMonth()
    if (!ventasData || !month) return 0
    return ventasData.reduce((sum, c) => sum + (c.ventaMensual?.[month] || 0), 0)
  },

  /** Pool de equipo operativo + C-Level operativos (asignables a PODs) */
  getTeamPool: () => {
    const { teamData, rate } = get()
    if (!teamData) return []
    return teamData
      .filter(p => !p.esOverhead || p.cLevelOperativo)
      .map(p => ({
        ...p,
        costoUSD: Math.round((p.costoMensualARS || p.neto || 0) / rate),
      }))
  },

  /** Pool de clientes activos con revenue del mes */
  getClientPool: () => {
    const { ventasData } = get()
    const month = get().getCurrentMonth()
    if (!ventasData || !month) return []
    return ventasData
      .map(c => ({
        nombre: c.nombre,
        tipo: c.tipo,
        revenue: c.ventaMensual?.[month] || 0,
      }))
      .filter(c => c.revenue > 0)
      .sort((a, b) => b.revenue - a.revenue)
  },

  /** Indica si hay datos live (no solo locales) */
  isLive: () => {
    const { teamSource, ventasSource, lookerSource } = get()
    return teamSource === 'sheets' || ventasSource === 'sheets' || lookerSource === 'sheets'
  },

  /** Indica si hay algún error activo */
  hasErrors: () => {
    const { teamError, ventasError, rateError, lookerError } = get()
    return !!(teamError || ventasError || rateError || lookerError)
  },

}))

export default useDataStore
