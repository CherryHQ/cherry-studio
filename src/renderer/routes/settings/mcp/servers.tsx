import McpServersList from '@renderer/pages/settings/McpSettings/McpServersList'
import { CreateMcpServerSchema } from '@shared/data/api/schemas/mcpServers'
import { createFileRoute } from '@tanstack/react-router'
import * as z from 'zod'

const mcpServersSearchSchema = z.object({
  protocolInstall: CreateMcpServerSchema.array().min(1).optional(),
  protocolInstallRequestId: z.string().min(1).optional()
})

export const Route = createFileRoute('/settings/mcp/servers')({
  validateSearch: (search) => mcpServersSearchSchema.parse(search),
  component: McpServersList
})
