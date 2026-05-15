import MiniAppPage from '@renderer/pages/mini-apps/MiniAppPage'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/app/mini-app/$appId')({
  component: MiniAppPage
})
