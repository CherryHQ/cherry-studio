import { Button } from '@cherrystudio/ui'
import { cn } from '@renderer/utils/style'
import { Images, type LucideIcon, Maximize2, Pencil, Shuffle } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import type { PaintingData } from '../../model/types/paintingData'
import { paintingClasses } from '../../paintingPrimitives'
import { useCanvasActions } from './canvasActions'
import { CANVAS_OPS } from './canvasOps'

const OP_ICON: Record<string, LucideIcon> = {
  variation: Shuffle,
  edit: Pencil,
  reference: Images,
  upscale: Maximize2
}

/**
 * Floating op bar shown above a selected card. `nodrag nopan` keep clicks from
 * panning the canvas or dragging the node; each op derives a new generation.
 */
const NodeToolbar: FC<{ painting: PaintingData }> = ({ painting }) => {
  const { t } = useTranslation()
  const { onNodeOp } = useCanvasActions()

  return (
    <div className="nodrag nopan -top-11 -translate-x-1/2 absolute left-1/2 z-10">
      <div className={paintingClasses.toolbarRail}>
        {CANVAS_OPS.map((op) => {
          const Icon = OP_ICON[op.id]
          return (
            <Button
              key={op.id}
              type="button"
              size="sm"
              variant="ghost"
              className={cn(paintingClasses.toolbarButton, 'h-7 gap-1 px-2 font-normal text-xs')}
              onClick={() => onNodeOp(op, painting)}>
              <Icon className="size-3.5" />
              {t(op.labelKey)}
            </Button>
          )
        })}
      </div>
    </div>
  )
}

export default NodeToolbar
