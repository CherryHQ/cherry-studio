import { createFileRoute } from '@tanstack/react-router'
import * as z from 'zod'

const mcpSettingsSearchSchema = z.object({
  autoEnable: z.literal('true').optional()
})

import McpSettings from '@renderer/pages/settings/McpSettings/McpSettings'

export const Route = createFileRoute('/settings/mcp/settings/$serverId')({
  validateSearch: (search) => mcpSettingsSearchSchema.parse(search),
  component: McpSettings
})
