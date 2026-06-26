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
import { type FC, type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { usePaintingLineage } from '../../hooks/usePaintingLineage'
import type { PaintingData } from '../../model/types/paintingData'
import BackToContent from './BackToContent'
import { type CanvasActions, CanvasActionsProvider } from './canvasActions'
import PaintingNode, { PAINTING_NODE_WIDTH, type PaintingNodeType } from './PaintingNode'

// Module-level: an inline object would be a new type every render and remount
// the whole canvas (rerender-no-inline-components + React Flow's #1 footgun).
const NODE_TYPES: NodeTypes = { painting: PaintingNode }
const PRO_OPTIONS = { hideAttribution: true } as const

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
  /** Transient in-flight card (status `generating`) shown optimistically until it lands in `items`. */
  inflightCard: PaintingData | null
  /** Id of the selected card (drives selection ring + toolbar). Page-driven. */
  selectedId?: string
  actions: CanvasActions
  onSelectPainting: (painting: PaintingData) => void
  onMovePainting: (id: string, x: number, y: number) => void
  /** Click empty canvas → clear the selection. */
  onDeselect: () => void
  /** The single `<PaintingComposer>` element, floating bottom-center on the canvas. */
  composer: ReactNode
}

const CanvasView: FC<CanvasViewProps> = ({
  items,
  inflightCard,
  selectedId,
  actions,
  onSelectPainting,
  onMovePainting,
  onDeselect,
  composer
}) => {
  const { t } = useTranslation()
  // MiniMap is hidden by default; toggled from the controls toolbar.
  const [showMiniMap, setShowMiniMap] = useState(false)
  // Persist pan/zoom across reloads (localStorage). `null` = never moved → fitView.
  const [savedViewport, setSavedViewport] = usePersistCache('ui.painting.canvas_viewport')

  const generatingId = inflightCard?.id

  // De-dupe by id; surface the in-flight card until its record lands in history.
  const cards = useMemo(() => {
    const byId = new Map<string, PaintingData>()
    for (const item of items) byId.set(item.id, item)
    if (inflightCard && !byId.has(inflightCard.id)) byId.set(inflightCard.id, inflightCard)
    return [...byId.values()]
  }, [items, inflightCard])

  const edges = usePaintingLineage(cards)
  const [nodes, setNodes, onNodesChange] = useNodesState<PaintingNodeType>([])

  // Reconcile by id: keep existing nodes' (possibly dragged) positions, place
  // new cards from their persisted coords or the next auto-grid slot. Never
  // rebuild blindly — preserves drag state and node identity for memo.
  useEffect(() => {
    setNodes((prev) => {
      const prevById = new Map(prev.map((node) => [node.id, node]))
      let autoCount = prev.length
      return cards.map((card) => {
        const existing = prevById.get(card.id)
        let position: { x: number; y: number }
        if (existing) {
          position = existing.position
        } else if (card.canvasX != null && card.canvasY != null) {
          position = { x: card.canvasX, y: card.canvasY }
        } else {
          position = gridSlot(autoCount)
          autoCount++
        }
        const generating = card.id === generatingId
        const data =
          existing && existing.data.painting === card && existing.data.generating === generating
            ? existing.data
            : { painting: card, generating }
        // Square card; keep an in-session resize, else the persisted/default size.
        const size = existing?.width ?? card.canvasW ?? PAINTING_NODE_WIDTH
        return {
          id: card.id,
          type: 'painting' as const,
          position,
          selected: card.id === selectedId,
          data,
          width: size,
          height: size
        }
      })
    })
  }, [cards, generatingId, selectedId, setNodes])

  const handleNodeClick = useCallback<NodeMouseHandler<PaintingNodeType>>(
    (_event, node) => onSelectPainting(node.data.painting),
    [onSelectPainting]
  )

  // Persist placement only on drag end (not every mousemove).
  const handleNodeDragStop = useCallback<OnNodeDrag<PaintingNodeType>>(
    (_event, node) => onMovePainting(node.id, node.position.x, node.position.y),
    [onMovePainting]
  )

  return (
    <div className="relative h-full w-full">
      <CanvasActionsProvider value={actions}>
        <ReactFlow<PaintingNodeType>
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodesChange={onNodesChange}
          onNodeClick={handleNodeClick}
          onNodeDragStop={handleNodeDragStop}
          onPaneClick={onDeselect}
          onMoveEnd={(_, viewport) => setSavedViewport(viewport)}
          defaultViewport={savedViewport ?? undefined}
          onlyRenderVisibleElements
          elementsSelectable={false}
          nodesConnectable={false}
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
