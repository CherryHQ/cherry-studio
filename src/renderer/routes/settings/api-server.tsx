import { ApiGatewaySettings } from '@renderer/pages/settings/ToolSettings/ApiGatewaySettings'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/api-server')({
  component: ApiGatewaySettings
})
