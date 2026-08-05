import { createFileRoute } from '@tanstack/react-router'

import MiniAppsPage from '@renderer/pages/miniApps/MiniAppsPage'

export const Route = createFileRoute('/app/mini-app/')({
  component: MiniAppsPage
})
