import DisplaySettings from '@renderer/pages/settings/DisplaySettings/DisplaySettings'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/display')({
  component: DisplaySettings
})
