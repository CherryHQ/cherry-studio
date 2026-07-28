import * as React from 'react'

import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '../../primitives/context-menu'
import type {
  ImagePreviewAction,
  ImagePreviewActionContext,
  ImagePreviewActionErrorHandler,
  ImagePreviewItem
} from './types'

export interface ImagePreviewContextMenuProps {
  actions?: ImagePreviewAction[]
  children: React.ReactNode
  context: ImagePreviewActionContext
  item: ImagePreviewItem
  onActionError?: ImagePreviewActionErrorHandler
}

export function ImagePreviewContextMenu({
  actions = [],
  children,
  context,
  item,
  onActionError
}: ImagePreviewContextMenuProps) {
  if (actions.length === 0) {
    return <>{children}</>
  }

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
              Promise.resolve()
                .then(() => action.onSelect(item, context))
                .catch((error) => onActionError?.(error, action, item))
            }}>
            {action.icon}
            {action.label}
          </ContextMenuItem>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  )
}
