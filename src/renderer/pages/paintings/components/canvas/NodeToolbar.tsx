import { Button } from '@cherrystudio/ui'
import { cn } from '@renderer/utils/style'
import { type LucideIcon, MessageSquarePlus, Pencil, RefreshCw } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import type { PaintingData } from '../../model/types/paintingData'
import { paintingClasses } from '../../paintingPrimitives'
import { useCanvasActions } from './canvasActions'

/**
 * Floating action bar shown above a selected card. `nodrag nopan` keep clicks
 * from panning the canvas or dragging the node. Three actions: edit (load the
 * image into the composer), regenerate (one-click rerun of the same recipe), and
 * add-to-chat (drop the image into the current composer as an input).
 */
const NodeToolbar: FC<{ painting: PaintingData }> = ({ painting }) => {
  const { t } = useTranslation()
  const { onEdit, onRegenerate, onAddToChat } = useCanvasActions()

  const actions: { id: string; icon: LucideIcon; label: string; run: () => void }[] = [
    { id: 'edit', icon: Pencil, label: t('paintings.canvas.op.edit'), run: () => onEdit(painting) },
    {
      id: 'regenerate',
      icon: RefreshCw,
      label: t('paintings.canvas.op.regenerate'),
      run: () => onRegenerate(painting)
    },
    {
      id: 'add_to_chat',
      icon: MessageSquarePlus,
      label: t('paintings.canvas.op.add_to_chat'),
      run: () => onAddToChat(painting)
    }
  ]

  return (
    <div className="nodrag nopan -top-11 -translate-x-1/2 absolute left-1/2 z-10">
      <div className={paintingClasses.toolbarRail}>
        {actions.map(({ id, icon: Icon, label, run }) => (
          <Button
            key={id}
            type="button"
            size="sm"
            variant="ghost"
            className={cn(paintingClasses.toolbarButton, 'h-7 gap-1 px-2 font-normal text-xs')}
            onClick={run}>
            <Icon className="size-3.5" />
            {label}
          </Button>
        ))}
      </div>
    </div>
  )
}

export default NodeToolbar
