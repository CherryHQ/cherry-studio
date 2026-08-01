import * as z from 'zod'

const protocolMcpServerMetadata = {
  name: z.string().min(1),
  description: z.string().optional()
}

const protocolMcpRemoteServer = {
  ...protocolMcpServerMetadata,
  type: z.enum(['sse', 'streamableHttp']).optional(),
  baseUrl: z.string().min(1),
  headers: z.record(z.string(), z.string()).optional()
}

const protocolMcpStdioServer = {
  ...protocolMcpServerMetadata,
  type: z.literal('stdio').optional(),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional()
}

const protocolMcpInstallMetadata = {
  installSource: z.literal('protocol'),
  isTrusted: z.literal(false),
  isActive: z.literal(false),
  installedAt: z.number()
}

export const ProtocolMcpServerConfigSchema = z.union([
  z.strictObject(protocolMcpRemoteServer),
  z.strictObject(protocolMcpStdioServer)
])

export const ProtocolMcpServerInstallSchema = z.union([
  z.strictObject({ ...protocolMcpRemoteServer, ...protocolMcpInstallMetadata }),
  z.strictObject({ ...protocolMcpStdioServer, ...protocolMcpInstallMetadata })
])

export const ProtocolMcpServersInstallSchema = ProtocolMcpServerInstallSchema.array().min(1)

export type ProtocolMcpServerInstall = z.infer<typeof ProtocolMcpServerInstallSchema>
