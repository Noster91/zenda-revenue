/**
 * PodKanban.jsx
 * Vista Kanban drag & drop para diseño de PODs.
 * Alternativa visual al diseñador de lista.
 * Pool a la izquierda, columnas por POD, tarjetas arrastrables.
 */
import { useState, useMemo, useCallback } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  pointerWithin,
} from '@dnd-kit/core'
import usePodDesignStore from '../store/usePodDesignStore'
import { usePodMetrics } from '../hooks/usePodMetrics'
import { formatUSD, formatPct } from '../utils/formatters'
import { POD_COLORS } from '../utils/podColors'
import { useAuth } from '../context/AuthContext'

const EXTRA_COLORS = [
  '#F59E0B','#8B5CF6','#EC4899','#14B8A6','#F97316','#6366F1',
  '#EF4444','#22D3EE','#A78BFA','#FB923C','#34D399','#E879F9',
]
function getColor(id, index) {
  return POD_COLORS[id] || EXTRA_COLORS[index % EXTRA_COLORS.length]
}

function margenBg(pct) {
  if (pct > 20)  return 'bg-success/10 text-success'
  if (pct >= 0)  return 'bg-warning/10 text-warning'
  return 'bg-danger/10 text-danger'
}

// ── Draggable wrapper ───────────────────────────────────────────────────────
function KanbanCard({ id, data, children }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id, data })
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, opacity: isDragging ? 0.25 : 1, zIndex: isDragging ? 999 : 'auto' }
    : {}
  return (
    <div ref={setNodeRef} style={style} {...listeners} {...attributes} className="touch-none">
      {children}
    </div>
  )
}

// ── Droppable column wrapper ────────────────────────────────────────────────
function KanbanColumn({ id, children, className, style: styleProp }) {
  const { isOver, setNodeRef } = useDroppable({ id })
  return (
    <div ref={setNodeRef} className={className}
      style={{
        ...styleProp,
        boxShadow: isOver ? '0 0 0 2px #30b299, 0 0 20px rgba(48,178,153,0.15)' : undefined,
        transition: 'box-shadow 150ms ease',
      }}>
      {children}
    </div>
  )
}

// ── Card visuals ────────────────────────────────────────────────────────────
function TeamCardView({ member, color, showAllocation, hideFinance }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-all cursor-grab active:cursor-grabbing p-2">
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[8px] font-bold flex-shrink-0"
          style={{ background: color || '#374151' }}>
          {member.nombre.split(' ').map(n => n[0]).join('').slice(0,2)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-gray-800 truncate text-[11px] leading-tight">
            {member.nombre.split(' ').slice(0,2).join(' ')}
          </p>
          {showAllocation && member.allocation !== undefined && (
            <p className="text-[8px] text-gray-400">{member.allocation}%</p>
          )}
        </div>
        {!hideFinance && (
          <span className="font-bold flex-shrink-0 text-[10px] text-gray-500">
            {formatUSD(member.costoUSD)}
          </span>
        )}
      </div>
    </div>
  )
}

function ClientCardView({ client, hideFinance }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-all cursor-grab active:cursor-grabbing p-2">
      <div className="flex items-center gap-1.5">
        <span className={`px-1 py-0.5 rounded text-[8px] font-bold flex-shrink-0 ${
          client.tipo === 'A' ? 'bg-blue-100 text-blue-700' : 'bg-gray-200 text-gray-600'
        }`}>{client.tipo}</span>
        <span className="font-semibold text-gray-800 truncate flex-1 min-w-0 text-[11px]">
          {client.nombre}
        </span>
        {!hideFinance && (
          <span className="text-emerald-700 font-bold flex-shrink-0 text-[10px]">
            {formatUSD(client.revenue)}
          </span>
        )}
      </div>
    </div>
  )
}

// ── Remove button (X) for items inside POD columns ──────────────────────────
function RemoveButton({ onClick }) {
  return (
    <button
      onClick={e => { e.stopPropagation(); onClick() }}
      onPointerDown={e => e.stopPropagation()}
      className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-white border border-gray-300 text-gray-400 hover:text-danger hover:border-danger text-[9px] flex items-center justify-center opacity-0 group-hover/card:opacity-100 transition-opacity shadow-sm z-10"
      title="Quitar">
      ✕
    </button>
  )
}

// ── Main PodKanban Component ────────────────────────────────────────────────
export default function PodKanban({ teamPool, clientPool }) {
  const {
    pods, assignments, clientAssignments,
    assignMember, removeMember, assignClient, removeClient,
  } = usePodDesignStore()

  const { podMetrics } = usePodMetrics()
  const { role } = useAuth()
  const hideFinance = role === 'hr'

  const [activeItem, setActiveItem] = useState(null)
  const [poolTab, setPoolTab] = useState('equipo')
  const [search, setSearch] = useState('')

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  )

  // ── Usage maps ────────────────────────────────────────────────────────────
  const memberUsage = useMemo(() => {
    const usage = {}
    Object.entries(assignments).forEach(([podId, members]) => {
      members.forEach(m => {
        if (!usage[m.nombre]) usage[m.nombre] = { total: 0, pods: [] }
        usage[m.nombre].total += m.allocation
        usage[m.nombre].pods.push({ podId, allocation: m.allocation })
      })
    })
    return usage
  }, [assignments])

  const clientUsage = useMemo(() => {
    const usage = {}
    Object.entries(clientAssignments).forEach(([podId, clients]) => {
      clients.forEach(c => { usage[c.nombre] = podId })
    })
    return usage
  }, [clientAssignments])

  // ── Filtered pools ────────────────────────────────────────────────────────
  const filteredTeam = useMemo(() =>
    teamPool.filter(m => m.nombre.toLowerCase().includes(search.toLowerCase())),
    [teamPool, search]
  )
  const unassignedClients = useMemo(() =>
    clientPool
      .filter(c => !clientUsage[c.nombre])
      .filter(c => c.nombre.toLowerCase().includes(search.toLowerCase())),
    [clientPool, clientUsage, search]
  )

  // ── Drag handlers ────────────────────────────────────────────────────────
  const handleDragStart = useCallback((event) => {
    setActiveItem(event.active.data.current)
  }, [])

  const handleDragCancel = useCallback(() => {
    setActiveItem(null)
  }, [])

  const handleDragEnd = useCallback((event) => {
    const { active, over } = event
    setActiveItem(null)
    if (!over) return

    const dragData = active.data.current
    const targetId = String(over.id)

    // Dropped back on pool → remove from POD
    if (targetId === 'pool') {
      if (dragData.fromPod) {
        if (dragData.itemType === 'team') removeMember(dragData.fromPod, dragData.nombre)
        else removeClient(dragData.fromPod, dragData.nombre)
      }
      return
    }

    // Dropped on a POD column
    if (targetId.startsWith('pod-')) {
      const targetPodId = targetId.replace('pod-', '')
      if (!pods.find(p => p.id === targetPodId)) return

      if (dragData.itemType === 'team') {
        assignMember(targetPodId, { nombre: dragData.nombre, costoUSD: dragData.costoUSD })
      } else if (dragData.itemType === 'client') {
        assignClient(targetPodId, { nombre: dragData.nombre, tipo: dragData.tipo, revenue: dragData.revenue })
      }
    }
  }, [pods, assignMember, removeMember, assignClient, removeClient])

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="flex gap-3 overflow-x-auto pb-4 pr-2" style={{ minHeight: '55vh' }}>

        {/* ─── Pool Column ─── */}
        <KanbanColumn id="pool"
          className="w-56 flex-shrink-0 bg-gray-50 rounded-2xl border-2 border-gray-200 p-3 flex flex-col">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-bold text-textPrimary">📦 Pool</span>
            <span className="text-[9px] text-gray-400 font-medium">
              {poolTab === 'equipo' ? `${filteredTeam.length} personas` : `${unassignedClients.length} disponibles`}
            </span>
          </div>

          <div className="flex rounded-md p-0.5 mb-2 bg-white border border-gray-200">
            {[
              { key: 'equipo', label: 'Equipo' },
              { key: 'clientes', label: 'Clientes' },
            ].map(tab => (
              <button key={tab.key}
                onClick={() => { setPoolTab(tab.key); setSearch('') }}
                className={`flex-1 text-[10px] font-semibold py-1 rounded transition-all ${
                  poolTab === tab.key ? 'bg-accent/10 text-accent' : 'text-textSecondary hover:text-textPrimary'
                }`}>
                {tab.label}
              </button>
            ))}
          </div>

          <input
            type="text"
            placeholder="Buscar..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full text-[10px] border border-gray-200 rounded-lg px-2 py-1.5 mb-2 focus:outline-none focus:ring-1 focus:ring-accent/30"
          />

          <div className="flex-1 overflow-y-auto space-y-1.5 min-h-0 pr-0.5">
            {poolTab === 'equipo' && filteredTeam.map(member => {
              const usage = memberUsage[member.nombre]
              const isFullyAllocated = usage && usage.total >= 100
              if (isFullyAllocated) return (
                <div key={member.nombre} className="opacity-35 pointer-events-none">
                  <TeamCardView member={member} hideFinance={hideFinance} />
                </div>
              )
              return (
                <KanbanCard
                  key={member.nombre}
                  id={`pool-team-${member.nombre}`}
                  data={{ itemType: 'team', nombre: member.nombre, costoUSD: member.costoUSD, fromPod: null }}
                >
                  <div className="relative">
                    <TeamCardView member={member} hideFinance={hideFinance} />
                    {usage && usage.total > 0 && (
                      <div className="absolute top-0.5 right-0.5 flex gap-0.5">
                        {usage.pods.map(p => (
                          <span key={p.podId} className="px-1 py-0 rounded text-[7px] font-bold"
                            style={{ background: (POD_COLORS[p.podId] || '#999') + '30', color: POD_COLORS[p.podId] || '#999' }}>
                            {p.podId} {p.allocation}%
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </KanbanCard>
              )
            })}

            {poolTab === 'clientes' && unassignedClients.map(client => (
              <KanbanCard
                key={client.nombre}
                id={`pool-client-${client.nombre}`}
                data={{ itemType: 'client', nombre: client.nombre, tipo: client.tipo, revenue: client.revenue, fromPod: null }}
              >
                <ClientCardView client={client} hideFinance={hideFinance} />
              </KanbanCard>
            ))}

            {poolTab === 'clientes' && unassignedClients.length === 0 && (
              <p className="text-[10px] text-gray-400 text-center py-6 italic">
                {clientPool.length === 0 ? 'Sin datos de clientes' : 'Todos los clientes están asignados ✓'}
              </p>
            )}
          </div>

          <div className="mt-2 pt-2 border-t border-gray-200 text-[8px] text-gray-400 text-center">
            Arrastrá hacia un POD →
          </div>
        </KanbanColumn>

        {/* ─── POD Columns ─── */}
        {podMetrics.map((pod, i) => {
          const color = getColor(pod.id, i)
          const podMembers = assignments[pod.id] || []
          const podClients = clientAssignments[pod.id] || []

          return (
            <KanbanColumn key={pod.id} id={`pod-${pod.id}`}
              className="w-52 flex-shrink-0 bg-white rounded-2xl border-2 border-gray-100 flex flex-col"
              style={{ borderTopColor: color, borderTopWidth: 4 }}>

              {/* Column header */}
              <div className="px-3 py-2" style={{ background: color + '10' }}>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: color }} />
                  <span className="text-xs font-bold text-textPrimary">{pod.id}</span>
                  <span className="text-[9px] text-textSecondary truncate flex-1 min-w-0">
                    {pod.nombre || '—'}
                  </span>
                </div>
                {!hideFinance && (
                <div className="grid grid-cols-3 gap-1 text-center">
                  <div className="bg-white/80 rounded px-1 py-0.5">
                    <p className="text-[7px] text-gray-400 leading-tight">Revenue</p>
                    <p className="text-[9px] font-bold text-emerald-600">{formatUSD(pod.revenue)}</p>
                  </div>
                  <div className="bg-white/80 rounded px-1 py-0.5">
                    <p className="text-[7px] text-gray-400 leading-tight">Costo</p>
                    <p className="text-[9px] font-bold text-gray-700">{formatUSD(pod.teamCost)}</p>
                  </div>
                  <div className={`rounded px-1 py-0.5 ${margenBg(pod.marginPct)}`}>
                    <p className="text-[7px] opacity-60 leading-tight">Margen</p>
                    <p className="text-[9px] font-bold">{formatPct(pod.marginPct)}</p>
                  </div>
                </div>
                )}
              </div>

              {/* Column content */}
              <div className="flex-1 overflow-y-auto p-2 space-y-1 min-h-[80px]">
                {/* Clients */}
                {podClients.length > 0 && (
                  <>
                    <p className="text-[8px] font-bold text-gray-400 uppercase tracking-wider px-0.5">
                      Clientes · {podClients.length}
                    </p>
                    {podClients.map(client => (
                      <div key={client.nombre} className="relative group/card">
                        <KanbanCard
                          id={`pod-${pod.id}-client-${client.nombre}`}
                          data={{ itemType: 'client', nombre: client.nombre, tipo: client.tipo, revenue: client.revenue, fromPod: pod.id }}
                        >
                          <ClientCardView client={client} hideFinance={hideFinance} />
                        </KanbanCard>
                        <RemoveButton onClick={() => removeClient(pod.id, client.nombre)} />
                      </div>
                    ))}
                  </>
                )}

                {/* Team */}
                {podMembers.length > 0 && (
                  <>
                    <p className={`text-[8px] font-bold text-gray-400 uppercase tracking-wider px-0.5 ${podClients.length > 0 ? 'mt-2' : ''}`}>
                      Equipo · {podMembers.length}
                    </p>
                    {podMembers.map(member => (
                      <div key={member.nombre} className="relative group/card">
                        <KanbanCard
                          id={`pod-${pod.id}-team-${member.nombre}`}
                          data={{ itemType: 'team', nombre: member.nombre, costoUSD: member.costoUSD, fromPod: pod.id }}
                        >
                          <TeamCardView member={member} color={color} showAllocation hideFinance={hideFinance} />
                        </KanbanCard>
                        <RemoveButton onClick={() => removeMember(pod.id, member.nombre)} />
                      </div>
                    ))}
                  </>
                )}

                {/* Empty state */}
                {podMembers.length === 0 && podClients.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-full min-h-[100px] gap-1">
                    <span className="text-2xl text-gray-200">+</span>
                    <p className="text-[9px] text-gray-300 italic text-center">
                      Arrastrá personas<br />o clientes aquí
                    </p>
                  </div>
                )}
              </div>

              {/* Column footer */}
              <div className="px-2 py-1.5 border-t border-gray-100 flex items-center justify-between text-[8px] text-gray-400">
                <span>{podMembers.length}p · {podClients.length}c</span>
                {!hideFinance && pod.revenue > 0 && (
                  <span className={pod.marginPct >= 0 ? 'text-success font-bold' : 'text-danger font-bold'}>
                    {formatUSD(pod.margin)}
                  </span>
                )}
              </div>
            </KanbanColumn>
          )
        })}
      </div>

      {/* Drag Overlay — floating card while dragging */}
      <DragOverlay dropAnimation={null}>
        {activeItem && (
          <div style={{ width: 200, opacity: 0.92, pointerEvents: 'none', filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.15))' }}>
            {activeItem.itemType === 'team'
              ? <TeamCardView member={{ nombre: activeItem.nombre, costoUSD: activeItem.costoUSD }} color="#30b299" hideFinance={hideFinance} />
              : <ClientCardView client={{ nombre: activeItem.nombre, tipo: activeItem.tipo, revenue: activeItem.revenue }} hideFinance={hideFinance} />
            }
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}
