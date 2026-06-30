import { ResourceCatalogView } from '@renderer/components/resource/catalog'
import { useNavigate } from '@tanstack/react-router'
import { useCallback } from 'react'

export default function LibraryPage() {
  const navigate = useNavigate()
  const handleOpenAssistantChat = useCallback(
    (assistantId: string) => {
      void navigate({ to: '/app/chat', search: { assistantId } })
    },
    [navigate]
  )

  return <ResourceCatalogView onOpenAssistantChat={handleOpenAssistantChat} />
}
