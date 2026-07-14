import CreationPage from '@renderer/pages/creation/CreationPage'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/app/paintings/')({
  component: CreationPage
})
