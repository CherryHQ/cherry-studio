import { createFileRoute } from '@tanstack/react-router'

import { MemorySettings } from '@renderer/pages/settings/MemorySettings'

export const Route = createFileRoute('/settings/memory')({
  component: MemorySettings,
  validateSearch: (search: Record<string, unknown>) => ({
    agentId: typeof search.agentId === 'string' && search.agentId ? search.agentId : undefined
  })
})
