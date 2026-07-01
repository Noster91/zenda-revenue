import { useLocation } from 'react-router-dom'
import useGlobalPeriod, { MES_LABELS } from '../hooks/useGlobalPeriod'

const titles = {
  '/': 'Dashboard General',
  '/pods': 'Vista por POD',
  '/pod-designer': 'Diseñador de PODs',
  '/clientes': 'Clientes',
  '/equipo': 'Equipo y Costos',
  '/rentabilidad': 'Rentabilidad',
  '/historico': 'Rendimiento Histórico',
}

const MODES = [
  { key: 'mensual',    label: 'Mensual' },
  { key: 'trimestral', label: 'Trimestral' },
  { key: 'anual',      label: 'Anual' },
]

export default function Header({ onMenuClick }) {
  const location = useLocation()
  const title = titles[location.pathname] || 'Dashboard'

  const {
    mode, selectedMonth, selectedQuarter, selectedYear,
    availableMonths, setMode, setSelectedMonth, setSelectedQuarter,
  } = useGlobalPeriod()

  const years = [...new Set(availableMonths.map(m => m.split('-')[1]))].sort()
  const monthsForYear = availableMonths.filter(m => m.split('-')[1] === selectedYear)

  const selectStyle = {
    fontFamily:    'var(--font-mono)',
    fontSize:      '11px',
    letterSpacing: '0.06em',
    color:         'var(--k)',
    background:    'var(--w)',
    border:        'var(--bw) solid var(--bdr)',
    borderRadius:  'var(--r-tag)',
    padding:       '5px 10px',
    outline:       'none',
    cursor:        'pointer',
  }

  return (
    <header
      className="sticky top-0 z-10 flex items-center justify-between px-4 lg:px-6 py-3"
      style={{
        background:   'rgba(250,251,249,0.92)',
        backdropFilter: 'blur(8px)',
        borderBottom: 'var(--bw) solid var(--bdr)',
      }}
    >
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuClick}
          className="lg:hidden p-1.5"
          style={{ color: 'var(--mu)', borderRadius: 'var(--r-tag)' }}
        >
          <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" d="M4 6h16M4 12h16M4 18h16"/>
          </svg>
        </button>
        <h1 style={{
          fontFamily:    'var(--font-display)',
          fontSize:      '21px',
          fontWeight:    700,
          letterSpacing: '-0.02em',
          lineHeight:    1.05,
          color:         'var(--k)',
        }}>
          {title}
        </h1>
      </div>

      {/* Period selector */}
      <div className="flex items-center gap-2">

        {/* Mode pill */}
        <div className="flex gap-0.5 p-1" style={{ background: 'var(--gray)', borderRadius: 'var(--r-pill)' }}>
          {MODES.map(m => (
            <button
              key={m.key}
              onClick={() => setMode(m.key)}
              style={{
                fontFamily:    'var(--font-mono)',
                fontSize:      '11px',
                letterSpacing: '0.04em',
                fontWeight:    mode === m.key ? 600 : 400,
                padding:       '5px 14px',
                borderRadius:  'var(--r-pill)',
                border:        'none',
                cursor:        'pointer',
                transition:    'background .15s, color .15s',
                background:    mode === m.key ? '#59D7A2' : 'transparent',
                color:         mode === m.key ? '#0A0A0B' : 'var(--mu)',
              }}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* Mensual picker */}
        {mode === 'mensual' && monthsForYear.length > 0 && (
          <select
            value={selectedMonth || ''}
            onChange={e => setSelectedMonth(e.target.value)}
            style={selectStyle}
          >
            {monthsForYear.map(m => {
              const prefix = m.split('-')[0]
              const yr     = m.split('-')[1]
              return (
                <option key={m} value={m}>
                  {MES_LABELS[prefix] || prefix} '{yr}
                </option>
              )
            })}
          </select>
        )}

        {/* Trimestral picker */}
        {mode === 'trimestral' && (
          <div className="flex gap-0.5 p-1" style={{ background: 'var(--gray)', borderRadius: 'var(--r-pill)' }}>
            {[1, 2, 3, 4].map(q => (
              <button
                key={q}
                onClick={() => setSelectedQuarter(q)}
                style={{
                  fontFamily:  'var(--font-mono)',
                  fontSize:    '11px',
                  fontWeight:  selectedQuarter === q ? 600 : 400,
                  padding:     '4px 10px',
                  borderRadius:'var(--r-pill)',
                  border:      'none',
                  cursor:      'pointer',
                  background:  selectedQuarter === q ? '#59D7A2' : 'transparent',
                  color:       selectedQuarter === q ? '#0A0A0B' : 'var(--mu)',
                }}
              >
                Q{q}
              </button>
            ))}
          </div>
        )}

        {/* Anual picker */}
        {mode === 'anual' && years.length > 1 && (
          <select
            value={selectedYear}
            onChange={e => useGlobalPeriod.getState().setSelectedYear(e.target.value)}
            style={selectStyle}
          >
            {years.map(y => (
              <option key={y} value={y}>20{y}</option>
            ))}
          </select>
        )}
      </div>
    </header>
  )
}
