import McpSettings from '@renderer/pages/settings/MCPSettings/McpSettings'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/mcp/settings/$serverId')({
  component: McpSettings
})
