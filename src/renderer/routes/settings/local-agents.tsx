import { createFileRoute } from '@tanstack/react-router'

import { LocalAgentSettingsPage } from '@renderer/pages/settings/LocalAgentSettings/LocalAgentSettingsPage'

export const Route = createFileRoute('/settings/local-agents')({
  validateSearch: (search: Record<string, unknown>) => ({ id: typeof search.id === 'string' ? search.id : undefined }),
  component: LocalAgentSettingsPage
})
