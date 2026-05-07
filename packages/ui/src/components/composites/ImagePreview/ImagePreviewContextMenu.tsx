import * as React from 'react'

import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '../../primitives/context-menu'
import type { ImagePreviewAction, ImagePreviewActionContext, ImagePreviewItem } from './types'

export interface ImagePreviewContextMenuProps {
  actions?: ImagePreviewAction[]
  children: React.ReactNode
  context?: Partial<ImagePreviewActionContext>
  item: ImagePreviewItem
}

const createFallbackContext = (
  item: ImagePreviewItem,
  context?: Partial<ImagePreviewActionContext>
): ImagePreviewActionContext => ({
  close: context?.close ?? (() => {}),
  index: context?.index ?? 0,
  items: context?.items ?? [item],
  resetTransform: context?.resetTransform ?? (() => {}),
  transform: context?.transform ?? { flipX: false, flipY: false, rotate: 0, scale: 1 }
})

export function ImagePreviewContextMenu({ actions = [], children, context, item }: ImagePreviewContextMenuProps) {
  if (actions.length === 0) {
    return <>{children}</>
  }

  const actionContext = createFallbackContext(item, context)

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        {actions.map((action) => (
          <ContextMenuItem
            disabled={action.disabled}
            key={action.id}
            onSelect={(event) => {
              event.preventDefault()
              void action.onSelect(item, actionContext)
            }}>
            {action.icon}
            {action.label}
          </ContextMenuItem>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  )
}
