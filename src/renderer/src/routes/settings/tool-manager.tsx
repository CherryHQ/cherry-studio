import ToolManagerSettings from '@renderer/pages/settings/ToolManagerSettings'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/tool-manager')({
  component: ToolManagerSettings
})
