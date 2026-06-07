import { DisplaySettings } from '@renderer/pages/settings/CommonSettings'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/display')({
  component: DisplaySettings
})
