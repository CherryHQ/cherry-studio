import MinAppPage from '@renderer/pages/minapps/MinAppPage'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/apps/$appId')({
  component: MinAppPage
})
