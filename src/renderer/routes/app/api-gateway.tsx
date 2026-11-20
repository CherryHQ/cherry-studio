import { createFileRoute } from '@tanstack/react-router'

import ApiGatewayPage from '@renderer/pages/apiGateway/ApiGatewayPage'

export const Route = createFileRoute('/app/api-gateway')({
  component: ApiGatewayPage
})
