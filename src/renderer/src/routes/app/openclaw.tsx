import OpenClawPage from '@renderer/pages/openclaw/OpenClawPage'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/app/openclaw')({
  component: OpenClawPage
})
