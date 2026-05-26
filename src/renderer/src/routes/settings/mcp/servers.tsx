import McpServersList from '@renderer/pages/settings/McpSettings/McpServersList'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/mcp/servers')({
  component: McpServersList
})
