import { Button } from '@cherrystudio/ui'
import FileManager from '@renderer/services/FileManager'
import { cn } from '@renderer/utils/style'
import { Handle, type Node, type NodeProps, NodeResizer, Position } from '@xyflow/react'
import { AlertTriangle, ImageIcon, RotateCcw } from 'lucide-react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'

import type { PaintingData } from '../../model/types/paintingData'
import { useCanvasActions } from './canvasActions'
import NodeContextMenu from './NodeContextMenu'
import NodeToolbar from './NodeToolbar'

/** Default square card size when a card carries no persisted `canvasW`. */
export const PAINTING_NODE_WIDTH = 240
const MIN_SIZE = 140
const MAX_SIZE = 720

export interface PaintingNodeData extends Record<string, unknown> {
  painting: PaintingData
  generating: boolean
}

export type PaintingNodeType = Node<PaintingNodeData, 'painting'>

const PaintingNodeComponent = ({ data, selected }: NodeProps<PaintingNodeType>) => {
  const { painting, generating } = data
  const { onResize, onRetry } = useCanvasActions()
  const { t } = useTranslation()
  const file = painting.files[0]
  const url = file ? FileManager.getFileUrl(file) : ''
  const extraCount = painting.files.length - 1
  // No image and not live-generating: a failed/canceled run → offer retry.
  // `status == null` is an empty board — either intentionally created or a new
  // generation interrupted before it finished (generating is never persisted) →
  // plain placeholder, no retry.
  const failed =
    painting.files.length === 0 && !generating && painting.status != null && painting.status !== 'succeeded'

  return (
    // NodeContextMenu's trigger is `asChild` (Radix Slot) — it must receive a
    // single element child, so everything (incl. the resizer) lives in one div.
    <NodeContextMenu painting={painting}>
      <div
        className={cn(
          'group relative flex h-full w-full flex-col overflow-visible border bg-card shadow-sm transition',
          selected ? 'border-primary ring-2 ring-primary/30' : 'border-border-subtle hover:border-border'
        )}>
        {/* Square, proportional resize — only when selected; dragging still moves. */}
        <NodeResizer
          isVisible={selected}
          keepAspectRatio
          minWidth={MIN_SIZE}
          maxWidth={MAX_SIZE}
          lineClassName="!border-primary/50"
          handleClassName="!size-2 !rounded-[2px] !border-2 !border-background !bg-primary"
          onResizeEnd={(_, params) => onResize(painting.id, Math.round(params.width))}
        />
        {/* Hidden handles let lineage edges attach; edges are display-only. */}
        <Handle type="target" position={Position.Left} className="!opacity-0" isConnectable={false} />
        <Handle type="source" position={Position.Right} className="!opacity-0" isConnectable={false} />

        <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-secondary">
          {generating ? (
            // Horizontal shimmer sweep (skeleton) while the image generates.
            <div className="animation-shimmer-block absolute inset-0" />
          ) : url ? (
            <img
              src={url}
              alt=""
              loading="lazy"
              decoding="async"
              draggable={false}
              className="h-full w-full object-cover"
            />
          ) : failed ? (
            <div className="flex flex-col items-center gap-2 px-3 text-center">
              <AlertTriangle className="size-7 text-destructive/70" />
              <Button
                size="sm"
                variant="outline"
                className="nodrag gap-1.5"
                onClick={(event) => {
                  event.stopPropagation()
                  onRetry(painting)
                }}>
                <RotateCcw className="size-3.5" />
                {t('paintings.canvas.retry')}
              </Button>
            </div>
          ) : (
            <ImageIcon className="size-8 text-muted-foreground/50" />
          )}

          {extraCount > 0 && (
            <div className="absolute top-1.5 right-1.5 rounded-full bg-foreground/60 px-1.5 py-0.5 text-[10px] text-background">
              +{extraCount}
            </div>
          )}

          {painting.prompt && (
            <div
              className="absolute inset-x-0 bottom-0 line-clamp-2 bg-gradient-to-t from-black/75 to-transparent px-2.5 pt-5 pb-1.5 text-[11px] text-white/90"
              title={painting.prompt}>
              {painting.prompt}
            </div>
          )}
        </div>

        {selected && <NodeToolbar painting={painting} />}
      </div>
    </NodeContextMenu>
  )
}

/** Memoized: React Flow re-renders nodes on every viewport change. */
const PaintingNode = memo(PaintingNodeComponent)
PaintingNode.displayName = 'PaintingNode'

export default PaintingNode
