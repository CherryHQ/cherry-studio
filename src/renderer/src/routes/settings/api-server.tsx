import { ApiServerSettings } from '@renderer/pages/settings/ToolSettings/ApiServerSettings'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/api-server')({
  component: ApiServerSettings
})
