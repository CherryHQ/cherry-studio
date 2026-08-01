import McpServersList from '@renderer/pages/settings/McpSettings/McpServersList'
import { ProtocolMcpServersInstallSchema } from '@shared/data/types/mcpProtocolInstall'
import { createFileRoute } from '@tanstack/react-router'
import * as z from 'zod'

const mcpServersSearchSchema = z.object({
  protocolInstall: ProtocolMcpServersInstallSchema.optional(),
  protocolInstallRequestId: z.string().min(1).optional()
})

export const Route = createFileRoute('/settings/mcp/servers')({
  validateSearch: (search) => mcpServersSearchSchema.parse(search),
  component: McpServersList
})
