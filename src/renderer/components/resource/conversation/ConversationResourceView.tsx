import { ResourceCatalogView } from '@renderer/components/resource/catalog'
import type { ResourceType } from '@renderer/types/resourceCatalog'
import { cn } from '@renderer/utils/style'
import { useMemo } from 'react'

export type ConversationResourceKind = Extract<ResourceType, 'assistant' | 'agent' | 'skill'>

type ConversationResourceViewProps = {
  className?: string
  kind: ConversationResourceKind
  /** Open a chat with the given assistant (e.g. after adding one from the library). Layout-aware. */
  onOpenAssistantChat?: (assistantId: string) => void
}

export function ConversationResourceView({ className, kind, onOpenAssistantChat }: ConversationResourceViewProps) {
  const resourceTypes = useMemo<readonly ConversationResourceKind[]>(() => [kind], [kind])

  return (
    <ResourceCatalogView
      allowedResourceTypes={resourceTypes}
      assistantCatalogEnabled={false}
      className={cn('bg-background', className)}
      defaultResourceType={kind}
      onOpenAssistantChat={onOpenAssistantChat}
      showSidebar={false}
    />
  )
}
