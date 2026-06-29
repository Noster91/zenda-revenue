/**
 * usePodMetrics.js
 * Calcula metricas por POD y globales a partir del store compartido.
 * Usado por PodDesigner, Dashboard, Pods y Rentabilidad.
 *
 * Overhead ahora se computa dinamicamente desde los datos del sheet
 * (personas marcadas como esOverhead), eliminando valores hardcodeados.
 */
import { useMemo } from 'react'
import usePodDesignStore from '../store/usePodDesignStore'
import useDataStore from '../store/useDataStore'
import { usePeriodValues } from './useGlobalPeriod'

export function usePodMetrics() {
  const pods = usePodDesignStore(s => s.pods)
  const assignments = usePodDesignStore(s => s.assignments)
  const clientAssignments = usePodDesignStore(s => s.clientAssignments)
  const revenueOverrides = usePodDesignStore(s => s.revenueOverrides)
  const overheadManual = usePodDesignStore(s => s.overheadManual)

  // Overhead dinamico desde datos live
  const teamData   = useDataStore(s => s.teamData)
  const lookerData = useDataStore(s => s.lookerData)
  const rate = useDataStore(s => s.rate)

  // Todos los 6 C-Level (detectados por apellido en sheetsService)
  const overheadFromSheet = useMemo(() => {
    if (!teamData || !rate) return 0
    return Math.round(
      teamData
        .filter(p => p.esOverhead)
        .reduce((sum, p) => sum + (p.costoMensualARS || p.neto || 0), 0) / rate
    )
  }, [teamData, rate])

  // Fracción de C-Level operativos ya asignada a PODs — se resta para evitar doble conteo
  const allocatedCLevelOpCost = useMemo(() => {
    if (!teamData || !rate) return 0
    const opCosts = {}
    teamData
      .filter(p => p.cLevelOperativo)
      .forEach(p => { opCosts[p.nombre] = Math.round((p.costoMensualARS || p.neto || 0) / rate) })

    let total = 0
    Object.values(assignments).forEach(members =>
      members.forEach(m => {
        if (opCosts[m.nombre] != null)
          total += (m.costoUSD ?? opCosts[m.nombre]) * m.allocation / 100
      })
    )
    return Math.round(total)
  }, [teamData, rate, assignments])

  const { selectedMonths } = usePeriodValues()

  // Estructura: valor del período seleccionado (promedio mensual)
  const estructuraUSD = useMemo(() => {
    if (!lookerData?.length) return 0
    if (selectedMonths?.length > 0) {
      const targetMeses = new Set(selectedMonths.map(m => m.replace('-', ' ')))
      const matching = lookerData.filter(d => targetMeses.has(d.mes))
      if (matching.length > 0) {
        return matching.reduce((s, d) => s + Math.abs(d.estructura || 0), 0) / matching.length
      }
    }
    return Math.abs(lookerData[lookerData.length - 1]?.estructura || 0)
  }, [lookerData, selectedMonths])

  // Overhead payroll efectivo:
  // - Sheet detecta los 6 (overheadFromSheet > 0): computed − fracción asignada a PODs
  // - Sheet aún no cargó (overheadFromSheet = 0): usa override manual como fallback
  const overheadPayroll = overheadFromSheet > 0
    ? Math.max(0, overheadFromSheet - allocatedCLevelOpCost)
    : (overheadManual ?? 0)

  // Overhead total = payroll efectivo + estructura
  const overheadUSD = overheadPayroll + estructuraUSD

  const podMetrics = useMemo(() => {
    const effectiveOverhead = overheadUSD || 0

    const allRevenues = pods.map(pod => {
      if (revenueOverrides[pod.id] !== undefined) return revenueOverrides[pod.id]
      return (clientAssignments[pod.id] || []).reduce((s, c) => s + c.revenue, 0)
    })
    const totalRevenue = allRevenues.reduce((s, v) => s + v, 0)

    return pods.map((pod, i) => {
      const members = assignments[pod.id] || []
      const clients = clientAssignments[pod.id] || []
      const revenue = allRevenues[i]
      const clientRevenue = clients.reduce((s, c) => s + c.revenue, 0)
      const teamCost = members.reduce((s, m) => s + (m.costoUSD * m.allocation / 100), 0)
      const gop = revenue - teamCost
      const gopPct = revenue ? (gop / revenue) * 100 : 0
      const overheadShare = totalRevenue
        ? (revenue / totalRevenue) * effectiveOverhead
        : pods.length ? effectiveOverhead / pods.length : 0
      const margin = gop - overheadShare
      const marginPct = revenue ? (margin / revenue) * 100 : 0

      return {
        ...pod,
        revenue,
        clientRevenue,
        teamCost: Math.round(teamCost),
        gop: Math.round(gop),
        gopPct: Math.round(gopPct * 10) / 10,
        overhead: Math.round(overheadShare),
        margin: Math.round(margin),
        marginPct: Math.round(marginPct * 10) / 10,
        members,
        clients,
        hasOverride: revenueOverrides[pod.id] !== undefined,
        // Compatible con PodCard y Pods.jsx
        metricas: {
          totalClientes: clients.length,
          totalEquipo: members.length,
          revenue,
          grossProfit: Math.round(gop),
          overhead: Math.round(overheadShare),
          total: Math.round(teamCost + overheadShare),
          margen: Math.round(margin),
          margenPct: Math.round(marginPct * 10) / 10,
        },
        clientes: clients.map(c => ({
          nombre: c.nombre,
          revenue: c.revenue,
          _orphaned: c._orphaned,
        })),
        equipo: members.map(m => ({
          nombre: m.nombre,
          porcentajeDedicacion: m.allocation,
          costoUSD: m.costoUSD || 0,
          _orphaned: m._orphaned,
        })),
      }
    })
  }, [pods, assignments, clientAssignments, revenueOverrides, overheadUSD])

  const globalMetrics = useMemo(() => {
    const revenue  = podMetrics.reduce((s, p) => s + p.revenue, 0)
    const teamCost = podMetrics.reduce((s, p) => s + p.teamCost, 0)
    const gop      = podMetrics.reduce((s, p) => s + p.gop, 0)
    const margin   = gop - overheadUSD
    return {
      revenue,
      teamCost,
      gop,
      gopPct: revenue ? Math.round((gop / revenue) * 1000) / 10 : 0,
      overhead: overheadUSD,
      margin,
      marginPct: revenue ? Math.round((margin / revenue) * 1000) / 10 : 0,
    }
  }, [podMetrics, overheadUSD])

  /** True si el usuario ha hecho al menos una asignacion */
  const hasDesign = useMemo(() =>
    Object.values(assignments).some(a => a.length > 0) ||
    Object.values(clientAssignments).some(a => a.length > 0),
    [assignments, clientAssignments]
  )

  /** Genera datos compatibles con resumen_equipos.json para Dashboard/Rentabilidad */
  const resumenFromDesign = useMemo(() =>
    podMetrics.map(pod => ({
      periodo: 'Diseno',
      pod: `${pod.id} ${pod.nombre}`,
      id: pod.id,
      revenue: pod.revenue,
      costoEquipo: pod.teamCost,
      gop: pod.gop,
      gopPct: pod.gopPct,
      overhead: pod.overhead,
      margen: pod.margin,
      margenPct: pod.marginPct,
    })),
    [podMetrics]
  )

  return { podMetrics, globalMetrics, hasDesign, resumenFromDesign, overheadUSD, overheadPayroll, overheadFromSheet, estructuraUSD, overheadManual }
}
