import MiniAppsPage from '@renderer/pages/miniApps/MiniAppsPage'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/app/mini-app/')({
  component: MiniAppsPage
})
