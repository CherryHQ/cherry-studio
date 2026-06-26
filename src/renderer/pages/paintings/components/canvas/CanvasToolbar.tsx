import { Button } from '@cherrystudio/ui'
import { cn } from '@renderer/utils/style'
import { Panel, useReactFlow, useStore } from '@xyflow/react'
import { Hand, ImagePlus, MousePointer2, SquarePlus } from 'lucide-react'
import { type FC, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { paintingClasses } from '../../paintingPrimitives'
import { PAINTING_NODE_WIDTH } from './PaintingNode'

/** Canvas interaction mode: `select` clicks/moves nodes, `pan` only pans. */
export type CanvasTool = 'select' | 'pan'

export interface CanvasPoint {
  x: number
  y: number
}

interface CanvasToolbarProps {
  tool: CanvasTool
  onToolChange: (tool: CanvasTool) => void
  /** Create an empty board (the composer generates into it) at the given flow point. */
  onAddBoard: (position: CanvasPoint) => void
  /** Import an image file as a source card at the given flow point. */
  onUploadAsset: (file: File, position: CanvasPoint) => void
}

const buttonClass = (active = false) =>
  cn(paintingClasses.toolbarButton, 'size-7 px-0', active && paintingClasses.toolbarButtonActive)

/**
 * Floating canvas toolbar (top-left): the select/pan tool switch plus quick
 * "upload asset" and "add blank board" actions. New cards land centered in the
 * current viewport, computed from the live React Flow viewport + pane size.
 */
const CanvasToolbar: FC<CanvasToolbarProps> = ({ tool, onToolChange, onAddBoard, onUploadAsset }) => {
  const { t } = useTranslation()
  const { getViewport } = useReactFlow()
  const width = useStore((state) => state.width)
  const height = useStore((state) => state.height)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Flow-space top-left so a default-size card sits centered in the viewport.
  const viewportCenter = (): CanvasPoint => {
    const { x, y, zoom } = getViewport()
    const half = PAINTING_NODE_WIDTH / 2
    return { x: (-x + width / 2) / zoom - half, y: (-y + height / 2) / zoom - half }
  }

  return (
    <Panel position="top-left" className="!m-3">
      <div className={paintingClasses.toolbarRail}>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-label={t('paintings.canvas.tool.select')}
          title={t('paintings.canvas.tool.select')}
          className={buttonClass(tool === 'select')}
          onClick={() => onToolChange('select')}>
          <MousePointer2 className="size-4" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-label={t('paintings.canvas.tool.pan')}
          title={t('paintings.canvas.tool.pan')}
          className={buttonClass(tool === 'pan')}
          onClick={() => onToolChange('pan')}>
          <Hand className="size-4" />
        </Button>

        <div className="mx-0.5 h-4 w-px bg-border-muted" />

        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-label={t('paintings.canvas.tool.upload')}
          title={t('paintings.canvas.tool.upload')}
          className={buttonClass()}
          onClick={() => fileInputRef.current?.click()}>
          <ImagePlus className="size-4" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-label={t('paintings.canvas.tool.add_board')}
          title={t('paintings.canvas.tool.add_board')}
          className={buttonClass()}
          onClick={() => onAddBoard(viewportCenter())}>
          <SquarePlus className="size-4" />
        </Button>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) onUploadAsset(file, viewportCenter())
            event.target.value = ''
          }}
        />
      </div>
    </Panel>
  )
}

export default CanvasToolbar
