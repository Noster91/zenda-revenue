import { supabase } from '../lib/supabase'

// ── Períodos ──────────────────────────────────────────────────────────────────

/** Trae todos los períodos con su estado */
export async function listPeriodos() {
  const { data, error } = await supabase
    .from('periodos')
    .select('*')
    .order('mes_num', { ascending: true })
  if (error) throw error
  return data || []
}

/** Trae el snapshot de un período cerrado */
export async function loadClosedPeriod(periodoId) {
  const { data, error } = await supabase
    .from('period_closes')
    .select('*')
    .eq('periodo_id', periodoId)
    .single()
  if (error) throw error
  return data
}

// ── Cierre ────────────────────────────────────────────────────────────────────

/**
 * Cierra un período guardando el snapshot completo.
 * @param {string} periodoId  — UUID del período
 * @param {object} snapshot   — { podDesign, teamCosts, revenue, overheadUsd, estructuraUsd, rate, metrics }
 * @param {string} userId     — UUID del usuario que cierra
 */
export async function closePeriod(periodoId, snapshot, userId) {
  const {
    podDesign, teamCosts, revenue,
    overheadUsd, estructuraUsd, rate, metrics,
  } = snapshot

  // Upsert snapshot (por si ya existe uno previo — reclose)
  const { error: snapError } = await supabase
    .from('period_closes')
    .upsert({
      periodo_id:     periodoId,
      pod_design:     podDesign,
      team_costs:     teamCosts,
      revenue,
      overhead_usd:   overheadUsd,
      estructura_usd: estructuraUsd,
      rate,
      metrics,
      closed_by:      userId,
      closed_at:      new Date().toISOString(),
      reopened_at:    null,
      reopened_by:    null,
    }, { onConflict: 'periodo_id' })

  if (snapError) throw snapError

  // Marcar el período como cerrado
  const { error: periodError } = await supabase
    .from('periodos')
    .update({
      estado:       'cerrado',
      fecha_cierre: new Date().toISOString(),
      closed_by:    userId,
    })
    .eq('id', periodoId)

  if (periodError) throw periodError
}

// ── Reapertura ────────────────────────────────────────────────────────────────

/**
 * Reabre un período cerrado. El snapshot queda registrado histórico
 * pero el período vuelve a estado 'abierto' y la app lee live desde Sheets.
 */
export async function reopenPeriod(periodoId, userId) {
  // Registrar quién reabrió en el snapshot existente
  const { error: snapError } = await supabase
    .from('period_closes')
    .update({
      reopened_at: new Date().toISOString(),
      reopened_by: userId,
    })
    .eq('periodo_id', periodoId)

  if (snapError) throw snapError

  // Volver el período a abierto
  const { error: periodError } = await supabase
    .from('periodos')
    .update({
      estado:       'abierto',
      fecha_cierre: null,
      closed_by:    null,
    })
    .eq('id', periodoId)

  if (periodError) throw periodError
}
