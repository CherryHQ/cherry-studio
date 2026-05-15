import McpServersList from '@renderer/pages/settings/MCPSettings/McpServersList'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/mcp/servers')({
  component: McpServersList
})
