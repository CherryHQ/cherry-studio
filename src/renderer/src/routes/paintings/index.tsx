import PaintingsRoutePage from '@renderer/pages/paintings/PaintingsRoutePage'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/paintings/')({
  component: PaintingsRoutePage
})
