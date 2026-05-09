import { FlipHorizontal, FlipVertical, RotateCcw, RotateCw, Undo2, X, ZoomIn, ZoomOut } from 'lucide-react'
import * as React from 'react'

import { cn } from '../../../lib/utils'
import { Button } from '../../primitives/button'
import { Tooltip } from '../../primitives/tooltip'
import type {
  ImagePreviewAction,
  ImagePreviewActionContext,
  ImagePreviewActionErrorHandler,
  ImagePreviewItem,
  ImagePreviewLabels
} from './types'
import type { ImagePreviewTransformControls } from './useImagePreviewTransform'

export interface ImagePreviewToolbarProps {
  actions?: ImagePreviewAction[]
  className?: string
  context: ImagePreviewActionContext
  item: ImagePreviewItem
  labels: ImagePreviewLabels
  onActionError?: ImagePreviewActionErrorHandler
  onClose: () => void
  transformControls: ImagePreviewTransformControls
}

interface ToolbarButtonProps {
  children: React.ReactNode
  disabled?: boolean
  label: string
  onClick: () => void
}

const ToolbarButton = ({ children, disabled, label, onClick }: ToolbarButtonProps) => (
  <Tooltip content={label} delay={300}>
    <Button
      aria-label={label}
      className="size-9 rounded-full border-border bg-background/80 text-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-40"
      disabled={disabled}
      onClick={onClick}
      size="icon"
      type="button"
      variant="outline">
      {children}
    </Button>
  </Tooltip>
)

export function ImagePreviewToolbar({
  actions = [],
  className,
  context,
  item,
  labels,
  onActionError,
  onClose,
  transformControls
}: ImagePreviewToolbarProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-1 rounded-full border border-border bg-background/80 px-2 py-1 text-foreground shadow-lg backdrop-blur',
        className
      )}
      onClick={(event) => event.stopPropagation()}>
      <ToolbarButton label={labels.flipVertical} onClick={transformControls.flipVertical}>
        <FlipVertical className="size-4" />
      </ToolbarButton>
      <ToolbarButton label={labels.flipHorizontal} onClick={transformControls.flipHorizontal}>
        <FlipHorizontal className="size-4" />
      </ToolbarButton>
      <ToolbarButton label={labels.rotateLeft} onClick={transformControls.rotateLeft}>
        <RotateCcw className="size-4" />
      </ToolbarButton>
      <ToolbarButton label={labels.rotateRight} onClick={transformControls.rotateRight}>
        <RotateCw className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        disabled={!transformControls.canZoomOut}
        label={labels.zoomOut}
        onClick={transformControls.zoomOut}>
        <ZoomOut className="size-4" />
      </ToolbarButton>
      <ToolbarButton disabled={!transformControls.canZoomIn} label={labels.zoomIn} onClick={transformControls.zoomIn}>
        <ZoomIn className="size-4" />
      </ToolbarButton>
      <ToolbarButton label={labels.reset} onClick={transformControls.reset}>
        <Undo2 className="size-4" />
      </ToolbarButton>
      {actions.map((action) => (
        <ToolbarButton
          disabled={action.disabled}
          key={action.id}
          label={action.label}
          onClick={() => {
            Promise.resolve()
              .then(() => action.onSelect(item, context))
              .catch((error) => onActionError?.(error, action, item))
          }}>
          {action.icon}
        </ToolbarButton>
      ))}
      <ToolbarButton label={labels.close} onClick={onClose}>
        <X className="size-4" />
      </ToolbarButton>
    </div>
  )
}
