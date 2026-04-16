import PaintingsPage from '@renderer/pages/paintings/PaintingsPage'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/app/paintings/$')({
  component: PaintingsPage
})
