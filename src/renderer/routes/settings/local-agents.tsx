import { createFileRoute } from '@tanstack/react-router'

import CodeCliPage from '@renderer/pages/code/CodeCliPage'

export const Route = createFileRoute('/settings/local-agents')({
  validateSearch: (search: Record<string, unknown>) => ({ id: typeof search.id === 'string' ? search.id : undefined }),
  component: () => <CodeCliPage destination="/settings/local-agents" />
})
