import '@xyflow/react/dist/style.css'

import { usePersistCache } from '@data/hooks/useCache'
import {
  ControlButton,
  Controls,
  MiniMap,
  type NodeMouseHandler,
  type NodeTypes,
  type OnNodeDrag,
  Panel,
  ReactFlow,
  useNodesState
} from '@xyflow/react'
import { Map as MapIcon } from 'lucide-react'
import { type FC, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { usePaintingLineage } from '../../hooks/usePaintingLineage'
import type { PaintingData } from '../../model/types/paintingData'
import BackToContent from './BackToContent'
import { type CanvasActions, CanvasActionsProvider } from './canvasActions'
import CanvasToolbar, { type CanvasPoint, type CanvasTool } from './CanvasToolbar'
import { boundingBox, clusterPosition, HULL_PADDING, hullBounds, type Rect, withinGroup } from './groupHull'
import PaintingGroupHull, { type PaintingGroupHullType } from './PaintingGroupHull'
import PaintingNode, { PAINTING_NODE_WIDTH, type PaintingNodeData, type PaintingNodeType } from './PaintingNode'

// Module-level: an inline object would be a new type every render and remount
// the whole canvas (rerender-no-inline-components + React Flow's #1 footgun).
const NODE_TYPES: NodeTypes = { painting: PaintingNode, groupHull: PaintingGroupHull }
const PRO_OPTIONS = { hideAttribution: true } as const

// Every painting is one draggable/resizable `painting` node. Paintings sharing a
// `group_id` (a multi-image generation) also get one derived `groupHull` backdrop
// behind them — membership only; each member keeps its own absolute position.
type CanvasNode = PaintingNodeType | PaintingGroupHullType
// Select tool: left button is reserved for selecting/moving nodes, so panning
// is mouse-middle-button only (plus scroll). Pan tool flips to left-drag panning.
const SELECT_PAN_BUTTONS: number[] = [1]

// Auto-grid fallback for cards with no persisted placement.
const GRID_COLS = 4
const COL_STEP = PAINTING_NODE_WIDTH + 56
const ROW_STEP = PAINTING_NODE_WIDTH + 120

function gridSlot(index: number): { x: number; y: number } {
  return { x: (index % GRID_COLS) * COL_STEP, y: Math.floor(index / GRID_COLS) * ROW_STEP }
}

interface CanvasViewProps {
  /** Persisted history cards. */
  items: PaintingData[]
  /** Transient in-flight placeholders (status `generating`) shown optimistically until they land in `items`. */
  inflightCards: PaintingData[]
  /** Id of the selected node — a painting id or a group hull id (`group:${groupId}`). */
  selectedId?: string
  actions: CanvasActions
  /** Select a node by id (painting id or group hull id). */
  onSelect: (nodeId: string) => void
  onMovePainting: (id: string, x: number, y: number) => void
  /** Detach a painting from its group (dragged out of the hull). */
  onUngroup: (id: string) => void
  /** Click empty canvas → clear the selection. */
  onDeselect: () => void
  /** Create an empty board (composer generates into it) at a flow point. */
  onAddBoard: (position: CanvasPoint) => void
  /** Import an image file as a source card at a flow point. */
  onUploadAsset: (file: File, position: CanvasPoint) => void
  /** The single `<PaintingComposer>` element, floating bottom-center on the canvas. */
  composer: ReactNode
}

const CanvasView: FC<CanvasViewProps> = ({
  items,
  inflightCards,
  selectedId,
  actions,
  onSelect,
  onMovePainting,
  onUngroup,
  onDeselect,
  onAddBoard,
  onUploadAsset,
  composer
}) => {
  const { t } = useTranslation()
  // Select clicks/moves nodes; pan only pans (and nodes are inert). Default select.
  const [tool, setTool] = useState<CanvasTool>('select')
  // MiniMap is hidden by default; toggled from the controls toolbar.
  const [showMiniMap, setShowMiniMap] = useState(false)
  // Persist pan/zoom across reloads (localStorage). `null` = never moved → fitView.
  const [savedViewport, setSavedViewport] = usePersistCache('ui.painting.canvas_viewport')

  // Spinner shows on any card whose generation is in flight (placeholders + retries).
  const generatingIds = useMemo(() => new Set(inflightCards.map((c) => c.id)), [inflightCards])

  // De-dupe by id; surface the in-flight placeholders until their records land in history.
  const cards = useMemo(() => {
    const byId = new Map<string, PaintingData>()
    for (const item of items) byId.set(item.id, item)
    for (const ic of inflightCards) if (!byId.has(ic.id)) byId.set(ic.id, ic)
    return [...byId.values()]
  }, [items, inflightCards])

  const edges = usePaintingLineage(cards)
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>([])
  // Latest nodes, for drag handlers that need sibling positions without re-binding.
  const nodesRef = useRef(nodes)
  nodesRef.current = nodes
  // Tracks the hull's last position during a group drag, to offset members by delta.
  const hullDragRef = useRef<{ id: string; x: number; y: number } | null>(null)

  // Reconcile by id: keep existing nodes' (possibly dragged) positions, place new
  // cards from their persisted coords or the next auto-grid slot. A group (>=2
  // paintings sharing a group_id) also yields a derived hull behind its members;
  // unplaced members cluster at one grid slot.
  useEffect(() => {
    setNodes((prev) => {
      const prevById = new Map(prev.map((node) => [node.id, node]))
      let autoCount = prev.filter((node) => node.type === 'painting').length

      const persistedPos = (card: PaintingData): { x: number; y: number } | null => {
        const ex = prevById.get(card.id)
        if (ex?.type === 'painting') return ex.position
        if (card.canvasX != null && card.canvasY != null) return { x: card.canvasX, y: card.canvasY }
        return null
      }
      const sizeOf = (card: PaintingData): number => {
        const ex = prevById.get(card.id)
        return (ex?.type === 'painting' ? ex.width : undefined) ?? card.canvasW ?? PAINTING_NODE_WIDTH
      }

      // Real groups: >=2 paintings sharing a group_id.
      const byGroup = new Map<string, PaintingData[]>()
      for (const card of cards) {
        if (!card.groupId) continue
        const arr = byGroup.get(card.groupId)
        if (arr) arr.push(card)
        else byGroup.set(card.groupId, [card])
      }
      for (const [gid, members] of byGroup) if (members.length < 2) byGroup.delete(gid)
      const groupedIds = new Set<string>()
      for (const members of byGroup.values()) for (const m of members) groupedIds.add(m.id)

      // Positions: singles take grid slots; group members keep their own or cluster.
      const posById = new Map<string, { x: number; y: number }>()
      for (const card of cards) {
        if (groupedIds.has(card.id)) continue
        posById.set(card.id, persistedPos(card) ?? gridSlot(autoCount++))
      }
      for (const members of byGroup.values()) {
        const positioned: Rect[] = []
        for (const m of members) {
          const p = persistedPos(m)
          if (p) {
            posById.set(m.id, p)
            const s = sizeOf(m)
            positioned.push({ x: p.x, y: p.y, width: s, height: s })
          }
        }
        // Cluster the unplaced members. When some are already placed, start to the
        // right of their bounding box so a new image never lands on a placed one.
        const placedBox = positioned.length ? boundingBox(positioned) : null
        const anchor = placedBox
          ? { x: placedBox.x + placedBox.width + HULL_PADDING, y: placedBox.y }
          : gridSlot(autoCount++)
        let clusterIdx = 0
        for (const m of members) {
          if (posById.has(m.id)) continue
          posById.set(m.id, clusterPosition(anchor, clusterIdx++, members.length - positioned.length))
        }
      }

      // Member nodes (one per painting).
      const memberNodes = cards.map((card): PaintingNodeType => {
        const generating = generatingIds.has(card.id)
        const ex = prevById.get(card.id)
        const data: PaintingNodeData =
          ex?.type === 'painting' && ex.data.painting === card && ex.data.generating === generating
            ? ex.data
            : { painting: card, generating }
        const size = sizeOf(card)
        return {
          id: card.id,
          type: 'painting',
          position: posById.get(card.id) ?? { x: 0, y: 0 },
          selected: card.id === selectedId,
          data,
          width: size,
          height: size,
          zIndex: 1
        }
      })

      // Hull backdrops (one per real group), behind members.
      const hullNodes: PaintingGroupHullType[] = []
      for (const [gid, members] of byGroup) {
        const rects = members.map((m) => {
          const p = posById.get(m.id) ?? { x: 0, y: 0 }
          const s = sizeOf(m)
          return { x: p.x, y: p.y, width: s, height: s }
        })
        const bounds = hullBounds(rects)
        const hullId = `group:${gid}`
        hullNodes.push({
          id: hullId,
          type: 'groupHull',
          position: { x: bounds.x, y: bounds.y },
          width: bounds.width,
          height: bounds.height,
          selected: hullId === selectedId,
          data: { groupId: gid, prompt: members[0].prompt },
          zIndex: 0
        })
      }

      return [...hullNodes, ...memberNodes]
    })
  }, [cards, generatingIds, selectedId, setNodes])

  const handleNodeClick = useCallback<NodeMouseHandler<CanvasNode>>(
    (_event, node) => {
      // Pan tool: nodes are inert — a click only pans the canvas, never selects.
      if (tool === 'pan') return
      // Clicking a hull selects the whole group; clicking a painting selects it.
      onSelect(node.id)
    },
    [onSelect, tool]
  )

  // Dragging the hull moves every member by the same delta (group move).
  const handleNodeDrag = useCallback<OnNodeDrag<CanvasNode>>(
    (_event, node) => {
      if (node.type !== 'groupHull') return
      const groupId = node.data.groupId
      const last = hullDragRef.current
      hullDragRef.current = { id: node.id, x: node.position.x, y: node.position.y }
      if (!last || last.id !== node.id) return
      const dx = node.position.x - last.x
      const dy = node.position.y - last.y
      if (dx === 0 && dy === 0) return
      setNodes((prev) =>
        prev.map((n) =>
          n.type === 'painting' && n.data.painting.groupId === groupId
            ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } }
            : n
        )
      )
    },
    [setNodes]
  )

  const handleNodeDragStop = useCallback<OnNodeDrag<CanvasNode>>(
    (_event, node) => {
      if (node.type === 'groupHull') {
        hullDragRef.current = null
        const groupId = node.data.groupId
        for (const n of nodesRef.current) {
          if (n.type === 'painting' && n.data.painting.groupId === groupId) {
            onMovePainting(n.id, n.position.x, n.position.y)
          }
        }
        return
      }

      // Member: persist its placement.
      onMovePainting(node.id, node.position.x, node.position.y)
      const card = node.data.painting
      if (!card.groupId) return

      const siblings = nodesRef.current.filter(
        (n): n is PaintingNodeType =>
          n.type === 'painting' && n.id !== node.id && n.data.painting.groupId === card.groupId
      )
      if (siblings.length === 0) return

      // Materialize any still-unplaced sibling so it doesn't snap back to the cluster.
      for (const sib of siblings) {
        if (sib.data.painting.canvasX == null || sib.data.painting.canvasY == null) {
          onMovePainting(sib.id, sib.position.x, sib.position.y)
        }
      }

      // Detach if the dragged card left the region of its remaining siblings.
      const size = node.width ?? PAINTING_NODE_WIDTH
      const memberRect = { x: node.position.x, y: node.position.y, width: size, height: size }
      const sibRects = siblings.map((s) => ({
        x: s.position.x,
        y: s.position.y,
        width: s.width ?? PAINTING_NODE_WIDTH,
        height: s.height ?? PAINTING_NODE_WIDTH
      }))
      if (!withinGroup(memberRect, boundingBox(sibRects))) {
        onUngroup(node.id)
      }
    },
    [onMovePainting, onUngroup]
  )

  return (
    <div className="relative h-full w-full">
      <CanvasActionsProvider value={actions}>
        <ReactFlow<CanvasNode>
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodesChange={onNodesChange}
          onNodeClick={handleNodeClick}
          onNodeDrag={handleNodeDrag}
          onNodeDragStop={handleNodeDragStop}
          onPaneClick={onDeselect}
          onMoveEnd={(_, viewport) => setSavedViewport(viewport)}
          defaultViewport={savedViewport ?? undefined}
          onlyRenderVisibleElements
          elementsSelectable={false}
          nodesConnectable={false}
          nodesDraggable={tool === 'select'}
          panOnDrag={tool === 'pan' ? true : SELECT_PAN_BUTTONS}
          deleteKeyCode={null}
          multiSelectionKeyCode={null}
          proOptions={PRO_OPTIONS}
          colorMode="system"
          minZoom={0.2}
          maxZoom={1.5}
          fitView={savedViewport == null}
          panOnScroll>
          <Controls position="bottom-left" showInteractive={false}>
            <ControlButton
              onClick={() => setShowMiniMap((v) => !v)}
              title={t('paintings.canvas.minimap')}
              aria-label={t('paintings.canvas.minimap')}
              className={showMiniMap ? 'text-primary!' : undefined}>
              <MapIcon />
            </ControlButton>
          </Controls>
          {showMiniMap && (
            <MiniMap
              position="bottom-right"
              pannable
              zoomable
              nodeColor="var(--color-muted)"
              bgColor="var(--color-card)"
              maskColor="color-mix(in srgb, var(--color-background) 72%, transparent)"
              className="overflow-hidden rounded-md border border-border shadow-sm"
            />
          )}
          {/* Top-left: tool switch (select / pan) + upload asset + add blank board. */}
          <CanvasToolbar tool={tool} onToolChange={setTool} onAddBoard={onAddBoard} onUploadAsset={onUploadAsset} />
          {/* Centered "back to content" button when all cards are off-screen. */}
          <BackToContent />
          {/* The one and only composer — floats bottom-center, always visible.
              Generating from it forks a new card, so it's the sole entry point. */}
          <Panel position="bottom-center" className="nodrag nopan !mb-1 w-[min(720px,calc(100vw-2rem))]">
            {composer}
          </Panel>
        </ReactFlow>
      </CanvasActionsProvider>
    </div>
  )
}

export default CanvasView
