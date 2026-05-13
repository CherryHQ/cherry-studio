import PaintingPage from '@renderer/pages/paintings'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/app/paintings/')({
  component: PaintingPage
})
