import { ResourceCatalogView } from '@renderer/components/resourceCatalog/catalog'
import type { ResourceType } from '@renderer/types/resourceCatalog'
import { cn } from '@renderer/utils/style'
import type { ReactNode } from 'react'

export type ConversationResourceKind = Extract<ResourceType, 'assistant' | 'agent' | 'skill'>

type ConversationResourceViewProps = {
  className?: string
  kind: ConversationResourceKind
  /** Open a chat with the given assistant (e.g. after adding one from the library). Layout-aware. */
  onOpenAssistantChat?: (assistantId: string) => void
  toolbarLeading?: ReactNode
}

export function ConversationResourceView({
  className,
  kind,
  onOpenAssistantChat,
  toolbarLeading
}: ConversationResourceViewProps) {
  return (
    <ResourceCatalogView
      className={cn('bg-background', className)}
      onOpenAssistantChat={onOpenAssistantChat}
      resourceType={kind}
      toolbarLeading={toolbarLeading}
    />
  )
}
