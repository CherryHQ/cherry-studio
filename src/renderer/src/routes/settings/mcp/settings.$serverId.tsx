import McpSettings from '@renderer/pages/settings/McpSettings/McpSettings'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/mcp/settings/$serverId')({
  component: McpSettings
})
