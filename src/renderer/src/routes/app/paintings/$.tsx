import PaintingsRoute from '@renderer/pages/paintings/route/PaintingsRoute'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/app/paintings/$')({
  component: PaintingsRoute
})
