import { cn } from '@renderer/utils/style'
import type { ReactNode } from 'react'

import { ResourceList } from './ResourceList'

export type ConversationResourceMenuItem = {
  active?: boolean
  icon?: ReactNode
  id: string
  label: ReactNode
  onSelect: () => void | Promise<void>
}

type ConversationResourceMenuProps = {
  items?: readonly ConversationResourceMenuItem[]
}

export function ConversationResourceMenu({ items }: ConversationResourceMenuProps) {
  if (!items?.length) return null

  return (
    <div className="flex flex-col gap-1" data-testid="conversation-resource-menu">
      {items.map((item) => (
        <ResourceList.HeaderItem
          key={item.id}
          type="button"
          icon={item.icon}
          label={item.label}
          aria-label={typeof item.label === 'string' ? item.label : undefined}
          aria-current={item.active ? 'page' : undefined}
          onClick={() => void item.onSelect()}
          className={cn(
            item.active &&
              'bg-sidebar-accent text-sidebar-foreground hover:bg-sidebar-accent focus-visible:bg-sidebar-accent [&_span]:text-sidebar-foreground'
          )}
        />
      ))}
    </div>
  )
}
