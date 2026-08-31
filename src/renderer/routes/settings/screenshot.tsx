import ScreenshotSettings from '@renderer/pages/settings/ScreenshotSettings/ScreenshotSettings'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/screenshot')({
  component: ScreenshotSettings
})
