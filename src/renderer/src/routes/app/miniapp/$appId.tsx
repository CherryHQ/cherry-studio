import MiniAppPage from '@renderer/pages/miniapps/MiniAppPage'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/app/miniapp/$appId')({
  component: MiniAppPage
})
