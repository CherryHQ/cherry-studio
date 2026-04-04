import ScreenshotPage from '@renderer/pages/screenshot/ScreenshotPage'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/app/screenshot')({
  component: ScreenshotPage
})
