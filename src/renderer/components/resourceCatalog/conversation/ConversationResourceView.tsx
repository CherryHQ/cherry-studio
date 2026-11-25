import type { ReactNode } from 'react'

import { ResourceCatalogView } from '@renderer/components/resourceCatalog/catalog'
import type { ResourceType } from '@renderer/types/resourceCatalog'
import { cn } from '@renderer/utils/style'

export type ConversationResourceKind = Extract<ResourceType, 'assistant' | 'agent' | 'skill'>

type ConversationResourceViewProps = {
  className?: string
  kind: ConversationResourceKind
  /** Open a chat with the given assistant (e.g. after adding one from the library). Layout-aware. */
  onOpenAssistantChat?: (assistantId: string) => void
  /** Open a chat with the given agent (e.g. after creating one). */
  onOpenAgentChat?: (agentId: string) => void
  toolbarLeading?: ReactNode
}

export function ConversationResourceView({
  className,
  kind,
  onOpenAssistantChat,
  onOpenAgentChat,
  toolbarLeading
}: ConversationResourceViewProps) {
  return (
    <ResourceCatalogView
      className={cn('bg-background', className)}
      onOpenAssistantChat={onOpenAssistantChat}
      onOpenAgentChat={onOpenAgentChat}
      resourceType={kind}
      toolbarLeading={toolbarLeading}
    />
  )
}
