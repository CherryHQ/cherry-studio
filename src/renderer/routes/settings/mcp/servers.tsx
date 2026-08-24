import McpServersList from '@renderer/pages/settings/McpSettings/McpServersList'
import { createFileRoute } from '@tanstack/react-router'
import * as z from 'zod'

const mcpServersSearchSchema = z.object({
  protocolInstallRequestId: z.uuid().optional()
})

export const Route = createFileRoute('/settings/mcp/servers')({
  validateSearch: (search) => mcpServersSearchSchema.parse(search),
  component: McpServersList
})
