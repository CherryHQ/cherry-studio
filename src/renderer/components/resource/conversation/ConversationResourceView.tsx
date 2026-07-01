import { ResourceCatalogView } from '@renderer/components/resource/catalog'
import type { ResourceType } from '@renderer/types/resourceCatalog'
import { cn } from '@renderer/utils/style'

export type ConversationResourceKind = Extract<ResourceType, 'assistant' | 'agent' | 'skill'>

type ConversationResourceViewProps = {
  className?: string
  kind: ConversationResourceKind
  /** Open a chat with the given assistant (e.g. after adding one from the library). Layout-aware. */
  onOpenAssistantChat?: (assistantId: string) => void
}

export function ConversationResourceView({ className, kind, onOpenAssistantChat }: ConversationResourceViewProps) {
  return (
    <ResourceCatalogView
      className={cn('bg-background', className)}
      onOpenAssistantChat={onOpenAssistantChat}
      resourceType={kind}
    />
  )
}
