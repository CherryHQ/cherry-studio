import { createFileRoute } from '@tanstack/react-router'

import MiniAppPage from '@renderer/pages/miniApps/MiniAppPage'

export const Route = createFileRoute('/app/mini-app/$appId')({
  component: MiniAppPage
})
