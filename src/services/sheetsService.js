/**
 * sheetsService.js
 * Conecta la app con Google Sheets API v4 (read-only via API key).
 * Configurar en .env:
 *   VITE_GOOGLE_SHEET_ID=<id del spreadsheet>
 *   VITE_GOOGLE_API_KEY=<api key de Google Cloud>
 */

import { C_LEVEL_ALL, detectCLevel } from '../utils/clevel'

const SHEET_ID        = import.meta.env.VITE_GOOGLE_SHEET_ID
const API_KEY         = import.meta.env.VITE_GOOGLE_API_KEY
const BASE            = 'https://sheets.googleapis.com/v4/spreadsheets'

export const LOOKER_SHEET_ID              = import.meta.env.VITE_LOOKER_SHEET_ID
export const TAB_VENTAS                   = import.meta.env.VITE_TAB_VENTAS                   || 'Ventas Dolarizadas'
export const TAB_TEAM                     = import.meta.env.VITE_TAB_TEAM                     || 'Team Costo Normalizado'
export const TAB_COSTOS_MENSUALIZADOS     = import.meta.env.VITE_TAB_COSTOS_MENSUALIZADOS     || 'Costos Mensualizados'
export const TAB_SUELDOS                  = import.meta.env.VITE_TAB_SUELDOS                  || 'Sueldos'
export const TAB_DATOS_LOOKER             = import.meta.env.VITE_TAB_DATOS_LOOKER             || 'Datos - Global'

/** True si las variables de entorno del sheet principal están configuradas */
export const isConfigured = () =>
  !!(SHEET_ID && API_KEY && SHEET_ID !== 'YOUR_SHEET_ID' && API_KEY !== 'YOUR_API_KEY')

/** True si el sheet de Looker está configurado */
export const isLookerConfigured = () =>
  !!(LOOKER_SHEET_ID && API_KEY && LOOKER_SHEET_ID !== 'YOUR_LOOKER_SHEET_ID')

/** Obtiene un rango de una solapa en cualquier sheet. Devuelve array de arrays (rows). */
async function getRange(sheetId, tabName, range = '') {
  const encodedTab = encodeURIComponent(tabName)
  const rangeParam = range ? `${encodedTab}!${range}` : encodedTab
  const url = `${BASE}/${sheetId}/values/${rangeParam}?key=${API_KEY}`
  const res = await fetch(url)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error?.message || `Google Sheets API error ${res.status}`)
  }
  const json = await res.json()
  return json.values || []
}

/** Convierte rows (array de arrays) en array de objetos usando la primera fila como headers */
function rowsToObjects(rows) {
  if (!rows.length) return []
  const [headers, ...data] = rows
  return data
    .filter(row => row.some(cell => cell?.toString().trim()))
    .map(row => {
      const obj = {}
      headers.forEach((h, i) => { obj[h.trim()] = row[i]?.toString().trim() ?? '' })
      return obj
    })
}

/** Parsea un string a número, manejando puntos/comas en formato AR */
function num(val) {
  if (val === null || val === undefined || val === '') return 0
  const clean = val.toString()
    .replace(/\./g, '')   // quita puntos de miles
    .replace(',', '.')    // coma decimal → punto
    .replace(/[^0-9.-]/g, '')
  return parseFloat(clean) || 0
}

/** Busca el valor de un objeto probando múltiples claves posibles */
function find(obj, keys) {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== '') return obj[k]
  }
  return ''
}

// ─────────────────────────────────────────────
// SUELDOS  →  formato team_cost.json
// ─────────────────────────────────────────────
export async function fetchSueldos(tabName = 'Sueldos') {
  const rows = await getRange(SHEET_ID, tabName)
  const objects = rowsToObjects(rows)

  return objects.map(obj => {
    const nombre = find(obj, ['Nombre', 'nombre', 'NOMBRE', 'Empleado', 'Colaborador'])
    if (!nombre) return null

    const neto    = num(find(obj, ['Neto', 'neto', 'Sueldo Neto', 'Básico', 'Salario Neto']))
    const cargas  = num(find(obj, ['Cargas', 'Cargas Sociales', 'cargasContrataciones', 'Cargas y Contrataciones']))
    const sac     = num(find(obj, ['SAC', 'sac', 'Aguinaldo']))
    const vac     = num(find(obj, ['Vacaciones', 'vacaciones', 'Provisión Vacaciones']))
    const costoAnual = num(find(obj, ['Costo Anual ARS', 'costoAnualARS', 'Costo Total Anual'])) ||
                       (neto + cargas + sac + vac) * 12

    const usd1300 = num(find(obj, ['USD @1300', 'costoUSD_1300', 'USD 1300'])) ||
                    Math.round((neto + cargas / 12) / 1300)
    const usd1400 = num(find(obj, ['USD @1400', 'costoUSD_1400', 'USD 1400'])) ||
                    Math.round((neto + cargas / 12) / 1400)

    const catRaw  = find(obj, ['Categoria', 'categoria', 'Categoría', 'Tipo', 'Rol'])
    const esOverhead = ['ceo','cmo','coo','overhead','c-level'].some(k =>
      catRaw.toLowerCase().includes(k) || nombre.toLowerCase().includes(k)
    )

    return {
      nombre,
      costoAnualARS: costoAnual,
      cargasContrataciones: cargas,
      neto,
      sac,
      vacaciones: vac,
      costoUSD_1300: usd1300,
      costoUSD_1400: usd1400,
      ...(esOverhead && { esOverhead: true, categoria: catRaw || nombre }),
    }
  }).filter(Boolean)
}

// ─────────────────────────────────────────────
// COMERCIAL GLOBAL  →  formato clients_sales.json
// ─────────────────────────────────────────────
const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const MES_ALIAS = {
  Ene: ['Ene', 'Enero', 'Jan', 'January'],
  Feb: ['Feb', 'Febrero', 'February'],
  Mar: ['Mar', 'Marzo', 'March'],
  Abr: ['Abr', 'Abril', 'Apr', 'April'],
  May: ['May', 'Mayo'],
  Jun: ['Jun', 'Junio', 'June'],
  Jul: ['Jul', 'Julio', 'July'],
  Ago: ['Ago', 'Agosto', 'Aug', 'August'],
  Sep: ['Sep', 'Sept', 'Septiembre', 'September'],
  Oct: ['Oct', 'Octubre', 'October'],
  Nov: ['Nov', 'Noviembre', 'November'],
  Dic: ['Dic', 'Diciembre', 'Dec', 'December'],
}

export async function fetchComercial(tabName = 'Comercial Global') {
  const rows = await getRange(SHEET_ID, tabName)
  const objects = rowsToObjects(rows)

  return objects.map(obj => {
    const nombre = find(obj, ['Cliente', 'cliente', 'Nombre', 'nombre', 'Account', 'Cuenta'])
    if (!nombre) return null

    const ventaMensual = {}
    MESES.forEach(mes => {
      const aliases = MES_ALIAS[mes]
      const val = find(obj, aliases)
      ventaMensual[mes] = num(val)
    })

    return {
      nombre,
      tipo:        find(obj, ['Tipo', 'tipo', 'Tier']) || 'B',
      categoria:   find(obj, ['Categoria', 'categoría', 'Categoría', 'Servicio']) || 'General',
      pais:        find(obj, ['País', 'Pais', 'pais', 'Country']) || 'Argentina',
      responsable: find(obj, ['Responsable', 'responsable', 'Account Manager', 'AM', 'Lead']),
      exterior:    ['si','sí','yes','true'].includes(
                     find(obj, ['Exterior', 'exterior', 'Internacional']).toLowerCase()
                   ),
      estado:      find(obj, ['Estado', 'estado', 'Status']) || 'Activo',
      inicioMes:   find(obj, ['Inicio', 'inicioMes', 'Mes Inicio', 'Start']),
      ventaMensual,
    }
  }).filter(Boolean)
}

// ─────────────────────────────────────────────
// TEAM COSTO NORMALIZADO  →  formato team_cost.json
// ─────────────────────────────────────────────
export async function fetchTeamCostoNormalizado(tabName = 'Team Costo Normalizado') {
  const rows = await getRange(SHEET_ID, tabName)
  const objects = rowsToObjects(rows)

  return objects.map(obj => {
    const nombre = find(obj, ['Team', 'team', 'Nombre', 'nombre', 'Empleado', 'Colaborador'])
    if (!nombre) return null

    const costoMensualARS = num(find(obj, ['Total ARS', 'Total', 'total ARS', 'Costo Total', 'Costo Mensual']))
    const cargas  = num(find(obj, ['Cargas y Contr', 'Cargas y Contrib.', 'Cargas y Contrib', 'Cargas', 'cargas', 'Cargas Sociales', 'Cargas y Contrataciones']))
    const neto    = num(find(obj, ['Neto', 'neto', 'Sueldo Neto', 'Salario Neto']))
    const sac     = num(find(obj, ['SAC', 'sac', 'Aguinaldo']))
    const vac     = num(find(obj, ['Vac', 'Vac.', 'Vacaciones', 'vacaciones', 'Provisión Vacaciones']))

    const catRaw = find(obj, ['Categoria', 'categoria', 'Categoría', 'Tipo', 'Rol'])

    // Detección por apellido primero (garantiza match sin depender de keywords)
    const cLevelFlags = detectCLevel(nombre)
    const esOverhead = !!cLevelFlags || ['ceo', 'cmo', 'coo', 'overhead', 'c-level'].some(k =>
      catRaw.toLowerCase().includes(k)
    )
    const cLevelOperativo = cLevelFlags?.cLevelOperativo || false

    const efectivoMensual = costoMensualARS || (neto + cargas + sac / 12 + vac / 12)

    // Ignorar filas sin costo (personas inactivas / placeholders)
    if (efectivoMensual === 0) return null

    return {
      nombre,
      costoMensualARS: efectivoMensual,
      costoAnualARS: efectivoMensual * 12,
      cargasContrataciones: cargas,
      neto,
      sac,
      vacaciones: vac,
      ...(esOverhead && { esOverhead: true, categoria: catRaw || nombre }),
      ...(cLevelOperativo && { cLevelOperativo: true }),
    }
  }).filter(Boolean)
}

// ─────────────────────────────────────────────
// VENTAS DOLARIZADAS  →  array de clientes con revenue mensual USD
// ─────────────────────────────────────────────
// Captura columnas tipo ene-26, feb-26, sept-26 (3 o 4 letras)
const MES_COL_RE = /^[a-z]{3,4}-\d{2}$/i

export async function fetchVentasDolarizadas(tabName = 'Ventas Dolarizadas') {
  const rows = await getRange(SHEET_ID, tabName)
  if (!rows.length) return []

  const [headers] = rows
  const mesHeaders = headers.map(h => h.trim()).filter(h => MES_COL_RE.test(h))
  const objects = rowsToObjects(rows)

  return objects.map(obj => {
    const nombre = find(obj, ['Cliente', 'cliente', 'Nombre', 'nombre', 'Account', 'Cuenta'])
    if (!nombre) return null

    const estado = find(obj, ['Estado', 'estado', 'Status']) || 'Activo'
    if (['inactivo', 'cancelado', 'baja'].some(s => estado.toLowerCase().includes(s))) return null

    // Valores en el sheet están en miles de USD → multiplicar ×1000
    const ventaMensual = {}
    mesHeaders.forEach(col => { ventaMensual[col] = Math.round(num(obj[col]) * 1000) })

    return {
      nombre,
      tipo:     find(obj, ['Tipo de Cliente', 'Tipo', 'tipo', 'Tier']) || 'B',
      categoria:find(obj, ['Categoria', 'Categoría', 'categoría', 'Servicio']) || 'General',
      pais:     find(obj, ['País', 'Pais', 'pais', 'Country']) || 'Argentina',
      estado,
      inicio:   find(obj, ['Inicio', 'inicioMes', 'Mes Inicio', 'Start']),
      ventaMensual,
      meses: mesHeaders,
    }
  }).filter(Boolean)
}

// ─────────────────────────────────────────────
// COSTOS MENSUALIZADOS  →  costo real por persona y mes (2026)
// Fila 1: headers "persona" + columnas numéricas 1–12 (ene-26…dic-26)
// Cada celda: costo mensual totalizado en ARS para esa persona y mes
// ─────────────────────────────────────────────
const MES_NUM_TO_KEY = {
  '1':'ene-26','2':'feb-26','3':'mar-26','4':'abr-26',
  '5':'may-26','6':'jun-26','7':'jul-26','8':'ago-26',
  '9':'sept-26','10':'oct-26','11':'nov-26','12':'dic-26',
}

export async function fetchCostosMensualizados(tabName = TAB_COSTOS_MENSUALIZADOS) {
  const rows = await getRange(SHEET_ID, tabName)
  if (!rows.length) return []

  const [headers, ...data] = rows
  // Identificar columna de nombre y columnas de meses
  const nombreIdx = headers.findIndex(h => /persona|nombre|team/i.test(h.trim()))
  if (nombreIdx === -1) return []

  const mesColMap = {} // { colIndex: 'ene-26', ... }
  headers.forEach((h, i) => {
    // Headers pueden venir como '1', '1,00' o '1.00' según locale del sheet
    const normalized = String(Math.round(parseFloat(
      h.trim().replace(/\./g, '').replace(',', '.')
    )))
    const key = MES_NUM_TO_KEY[normalized]
    if (key) mesColMap[i] = key
  })

  return data
    .filter(row => row.some(cell => cell?.toString().trim()))
    .map(row => {
      const nombre = row[nombreIdx]?.toString().trim()
      if (!nombre) return null

      const costoByMonth = {}
      Object.entries(mesColMap).forEach(([i, mesKey]) => {
        costoByMonth[mesKey] = num(row[i]) || 0
      })

      const cLevelFlags = detectCLevel(nombre)
      const catRaw = ''
      const esOverhead = !!cLevelFlags || ['ceo','cmo','coo','overhead','c-level'].some(k =>
        nombre.toLowerCase().includes(k)
      )
      const cLevelOperativo = cLevelFlags?.cLevelOperativo || false

      return {
        nombre,
        costoByMonth,
        ...(esOverhead && { esOverhead: true, categoria: catRaw || nombre }),
        ...(cLevelOperativo && { cLevelOperativo: true }),
      }
    }).filter(Boolean)
}

/** Expone los nombres de las solapas disponibles en el spreadsheet */
export async function fetchSheetNames() {
  if (!isConfigured()) return []
  const url = `${BASE}/${SHEET_ID}?key=${API_KEY}&fields=sheets.properties.title`
  const res = await fetch(url)
  if (!res.ok) return []
  const json = await res.json()
  return (json.sheets || []).map(s => s.properties.title)
}

// ─────────────────────────────────────────────
// DATOS LOOKER  →  P&L mensual (EBITDA, Revenue, Costos, Margen)
// Sheet: 1AOe1RPrJrALdWApX4JlkV_AujwzyfgVhXufcdpIh8VA
// Tab:   Datos - Global
// Periodo formato: "MM/YYYY"
// ─────────────────────────────────────────────
const MES_NUM_MAP = {
  '01':'ene','02':'feb','03':'mar','04':'abr','05':'may','06':'jun',
  '07':'jul','08':'ago','09':'sep','10':'oct','11':'nov','12':'dic',
}

export async function fetchDatosLooker(tabName = TAB_DATOS_LOOKER) {
  const rows = await getRange(LOOKER_SHEET_ID, tabName)
  if (!rows.length) return []

  const objects = rowsToObjects(rows)

  return objects.map(obj => {
    const periodo = find(obj, ['Periodo', 'periodo', 'Period'])
    if (!periodo || !periodo.includes('/')) return null

    const [mm, yyyy] = periodo.split('/')
    const mes = `${MES_NUM_MAP[mm] || mm} ${yyyy.slice(-2)}`

    return {
      periodo,
      mes,
      ebitda:           num(find(obj, ['E300 - Operating Income (EBITDA)', 'E300'])),
      totalCosts:       num(find(obj, ['OC200 - Total Operating Costs', 'OC200'])),
      sueldosFreelance: num(find(obj, ['OC2011 - Sueldos y Freelances', 'OC2011'])),
      serviciosOp:      num(find(obj, ['OC2012 - Servicios Operativos', 'OC2012'])),
      serviciosFun:     num(find(obj, ['OC2013 - Servicios Funcionales', 'OC2013'])),
      impuestos:        num(find(obj, ['OC2015 - Impuestos y Bancarios', 'OC2015'])),
      revenue:          num(find(obj, ['RV100 - Revenue', 'RV100'])),
      ebitdaHistory:    num(find(obj, ['EBITDA History'])),
      revenueHistory:   num(find(obj, ['Revenue History'])),
      payroll:          num(find(obj, ['Payroll', 'payroll'])),
      distribuible:     num(find(obj, ['Distribuible', 'distribuible'])),
      margen:           num(find(obj, ['Margen', 'margen'])),
      estructura:       num(find(obj, ['Estructura', 'estructura'])) * 1000,
    }
  }).filter(Boolean).sort((a, b) => {
    const [am, ay] = a.periodo.split('/')
    const [bm, by] = b.periodo.split('/')
    return (parseInt(ay) * 12 + parseInt(am)) - (parseInt(by) * 12 + parseInt(bm))
  })
}
