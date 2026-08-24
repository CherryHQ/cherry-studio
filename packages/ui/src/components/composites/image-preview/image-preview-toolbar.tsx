import {
  FlipHorizontal,
  FlipVertical,
  RefreshCcw,
  RotateCcwSquare,
  RotateCwSquare,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
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
import type { ImagePreviewTransformControls } from './use-image-preview-transform'

export interface ImagePreviewToolbarProps {
  actions?: ImagePreviewAction[]
  className?: string
  context: ImagePreviewActionContext
  item: ImagePreviewItem
  labels: ImagePreviewLabels
  onActionError?: ImagePreviewActionErrorHandler
  transformControls: ImagePreviewTransformControls
}

interface ToolbarButtonProps {
  children: React.ReactNode
  disabled?: boolean
  label: string
  onClick: () => void
  pressed?: boolean
}

const ToolbarButton = ({ children, disabled, label, onClick, pressed }: ToolbarButtonProps) => (
  <Tooltip content={label} delay={300}>
    <Button
      aria-label={label}
      aria-pressed={pressed}
      className="size-9 rounded-full text-muted-foreground hover:text-foreground disabled:opacity-40"
      disabled={disabled}
      onClick={onClick}
      size="icon"
      type="button"
      variant="ghost">
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
  transformControls
}: ImagePreviewToolbarProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-1 rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-md',
        className
      )}
      onClick={(event) => event.stopPropagation()}>
      <ToolbarButton
        disabled={!transformControls.canZoomOut}
        label={labels.zoomOut}
        onClick={transformControls.zoomOut}>
        <ZoomOut className="size-4" />
      </ToolbarButton>
      <ToolbarButton disabled={!transformControls.canZoomIn} label={labels.zoomIn} onClick={transformControls.zoomIn}>
        <ZoomIn className="size-4" />
      </ToolbarButton>
      <ToolbarButton label={labels.rotateLeft} onClick={transformControls.rotateLeft}>
        <RotateCcwSquare className="size-4" />
      </ToolbarButton>
      <ToolbarButton label={labels.rotateRight} onClick={transformControls.rotateRight}>
        <RotateCwSquare className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label={labels.flipHorizontal}
        onClick={transformControls.flipHorizontal}
        pressed={transformControls.transform.flipX}>
        <FlipHorizontal className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label={labels.flipVertical}
        onClick={transformControls.flipVertical}
        pressed={transformControls.transform.flipY}>
        <FlipVertical className="size-4" />
      </ToolbarButton>
      <ToolbarButton label={labels.reset} onClick={transformControls.reset}>
        <RefreshCcw className="size-4" />
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
    </div>
  )
}
