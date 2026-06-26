/**
 * useGlobalPeriod.js
 * Store global de periodo temporal.
 * Permite seleccionar Mensual (un mes), Trimestral (Q1-Q4) o Anual.
 * Todas las paginas consumen este estado para filtrar revenue y costos.
 */
import { useMemo } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

const MES_ABR = ['ene','feb','mar','abr','may','jun','jul','ago','sept','oct','nov','dic']

const MES_LABELS = {
  ene: 'Ene', feb: 'Feb', mar: 'Mar', abr: 'Abr', may: 'May', jun: 'Jun',
  jul: 'Jul', ago: 'Ago', sept: 'Sep', oct: 'Oct', nov: 'Nov', dic: 'Dic',
}

/** Detecta el mes actual en el formato del sheet (ej: "abr-26") */
function detectCurrentMonth(availableMonths) {
  const now = new Date()
  for (let offset = 0; offset <= 12; offset++) {
    const d = new Date(now.getFullYear(), now.getMonth() - offset, 1)
    const col = `${MES_ABR[d.getMonth()]}-${String(d.getFullYear()).slice(2)}`
    if (availableMonths.includes(col)) return col
  }
  return availableMonths[0] || null
}

/** Dado un mes "abr-26", devuelve el quarter (1-4) */
function monthToQuarter(mesCol) {
  if (!mesCol) return 1
  const prefix = mesCol.split('-')[0]
  const idx = MES_ABR.indexOf(prefix)
  if (idx < 0) return 1
  return Math.floor(idx / 3) + 1
}

/** Devuelve los 3 meses de un quarter para un year */
function quarterMonths(quarter, year) {
  const startIdx = (quarter - 1) * 3
  return MES_ABR.slice(startIdx, startIdx + 3).map(m => `${m}-${year}`)
}

/** Devuelve todos los meses de un year */
function yearMonths(year) {
  return MES_ABR.map(m => `${m}-${year}`)
}

const useGlobalPeriod = create(
  persist(
    (set, get) => ({
      // Modo: 'mensual' | 'trimestral' | 'anual'
      mode: 'mensual',
      // Mes seleccionado (formato sheet: "abr-26")
      selectedMonth: null,
      // Quarter seleccionado (1-4)
      selectedQuarter: 2,
      // Year (formato "26")
      selectedYear: '26',
      // Meses disponibles del sheet (se actualizan al cargar datos)
      availableMonths: [],
      // Períodos cerrados: { [codigo]: { id, label, fecha_cierre } }
      closedPeriods: {},

      // ── Actions ────────────────────────────────────────────────────────────
      setMode: (mode) => set({ mode }),

      /** Carga el mapa de períodos cerrados desde Supabase */
      setClosedPeriods: (periodosArray) => {
        const map = {}
        periodosArray
          .filter(p => p.estado === 'cerrado')
          .forEach(p => { map[p.codigo] = { id: p.id, label: p.label, fecha_cierre: p.fecha_cierre } })
        set({ closedPeriods: map })
      },

      /** Marca un período como cerrado localmente (optimistic update) */
      markPeriodClosed: (codigo, id, label, fecha_cierre) =>
        set(s => ({
          closedPeriods: { ...s.closedPeriods, [codigo]: { id, label, fecha_cierre } }
        })),

      /** Marca un período como abierto localmente (optimistic update) */
      markPeriodOpen: (codigo) =>
        set(s => {
          const next = { ...s.closedPeriods }
          delete next[codigo]
          return { closedPeriods: next }
        }),

      setSelectedMonth: (month) => set(s => ({
        selectedMonth: month,
        selectedQuarter: monthToQuarter(month),
        selectedYear: month?.split('-')[1] || s.selectedYear,
      })),

      setSelectedQuarter: (q) => set({ selectedQuarter: q }),
      setSelectedYear: (y) => set({ selectedYear: y }),

      /** Actualiza los meses disponibles (llamado desde useDataOrchestrator) */
      setAvailableMonths: (months) => set(s => {
        const update = { availableMonths: months }
        // Auto-detectar mes actual si no hay seleccion
        if (!s.selectedMonth || !months.includes(s.selectedMonth)) {
          const detected = detectCurrentMonth(months)
          if (detected) {
            update.selectedMonth = detected
            update.selectedQuarter = monthToQuarter(detected)
            update.selectedYear = detected.split('-')[1]
          }
        }
        return update
      }),

      // ── Computed ───────────────────────────────────────────────────────────

      /** Devuelve array de meses a considerar segun el modo seleccionado */
      getSelectedMonths: () => {
        const { mode, selectedMonth, selectedQuarter, selectedYear, availableMonths } = get()
        let target = []
        if (mode === 'mensual') {
          target = selectedMonth ? [selectedMonth] : []
        } else if (mode === 'trimestral') {
          target = quarterMonths(selectedQuarter, selectedYear)
        } else {
          target = yearMonths(selectedYear)
        }
        // Filtrar solo los que existen en el sheet
        return target.filter(m => availableMonths.includes(m))
      },

      /** Multiplicador de costos (cuantos meses abarca el periodo) */
      getCostMultiplier: () => {
        const { mode } = get()
        if (mode === 'mensual') return 1
        if (mode === 'trimestral') return 3
        return 12
      },

      /** Label legible del periodo seleccionado */
      getPeriodLabel: () => {
        const { mode, selectedMonth, selectedQuarter, selectedYear } = get()
        const yr = `'${selectedYear}`
        if (mode === 'mensual' && selectedMonth) {
          const prefix = selectedMonth.split('-')[0]
          return `${MES_LABELS[prefix] || prefix} ${yr}`
        }
        if (mode === 'trimestral') return `Q${selectedQuarter} ${yr}`
        return `Anual ${yr}`
      },

      /** Label corto del modo */
      getModeLabel: () => {
        const { mode } = get()
        if (mode === 'mensual') return 'Mensual'
        if (mode === 'trimestral') return 'Trimestral'
        return 'Anual'
      },
    }),
    {
      name: 'zenda-period',
      partialize: (s) => ({
        mode: s.mode,
        selectedMonth: s.selectedMonth,
        selectedQuarter: s.selectedQuarter,
        selectedYear: s.selectedYear,
      }),
    }
  )
)

/**
 * Hook reactivo que devuelve valores computados del periodo.
 * Suscribe a los valores primitivos del store para que los componentes
 * se re-rendereen cuando cambia modo, mes, quarter o year.
 */
export function usePeriodValues() {
  const mode = useGlobalPeriod(s => s.mode)
  const selectedMonth = useGlobalPeriod(s => s.selectedMonth)
  const selectedQuarter = useGlobalPeriod(s => s.selectedQuarter)
  const selectedYear = useGlobalPeriod(s => s.selectedYear)
  const availableMonths = useGlobalPeriod(s => s.availableMonths)
  const closedPeriods = useGlobalPeriod(s => s.closedPeriods)

  const selectedMonths = useMemo(
    () => useGlobalPeriod.getState().getSelectedMonths(),
    [mode, selectedMonth, selectedQuarter, selectedYear, availableMonths]
  )

  const periodLabel = useMemo(
    () => useGlobalPeriod.getState().getPeriodLabel(),
    [mode, selectedMonth, selectedQuarter, selectedYear]
  )

  const costMultiplier = useMemo(
    () => useGlobalPeriod.getState().getCostMultiplier(),
    [mode]
  )

  const modeLabel = useMemo(
    () => useGlobalPeriod.getState().getModeLabel(),
    [mode]
  )

  // True si el mes seleccionado actualmente está cerrado
  const isCurrentPeriodClosed = !!(selectedMonth && closedPeriods[selectedMonth])
  const currentPeriodClose = selectedMonth ? closedPeriods[selectedMonth] : null

  return {
    mode, selectedMonth, selectedMonths, periodLabel, costMultiplier, modeLabel,
    closedPeriods, isCurrentPeriodClosed, currentPeriodClose,
  }
}

export default useGlobalPeriod
export { MES_ABR, MES_LABELS }
