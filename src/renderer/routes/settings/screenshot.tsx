import { createFileRoute } from '@tanstack/react-router'

import ScreenshotSettings from '@renderer/pages/settings/ScreenshotSettings/ScreenshotSettings'

export const Route = createFileRoute('/settings/screenshot')({
  component: ScreenshotSettings
})
