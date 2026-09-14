import { createFileRoute } from '@tanstack/react-router'

import { ApiGatewaySettings } from '@renderer/pages/settings/ToolSettings/ApiGatewaySettings'

export const Route = createFileRoute('/settings/api-gateway')({
  component: ApiGatewaySettings
})
