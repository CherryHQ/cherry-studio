import { getMcpServerPreset } from '@shared/data/presets/mcpServers'
import { McpConfigSampleSchema, type McpServerType, McpServerTypeSchema } from '@shared/data/types/mcpServer'
import * as z from 'zod'

import { type CreateMcpServerDto, CreateMcpServerSchema } from './mcpServers'

const LegacyMcpServerTypeSchema = z.string().min(1)
const ImportedTimeoutSchema = z.union([
  z.number(),
  z
    .string()
    .trim()
    .min(1)
    .transform((value, ctx) => {
      const parsed = Number(value)
      if (!Number.isFinite(parsed)) {
        ctx.addIssue({ code: 'custom', message: 'Timeout must be a number' })
        return z.NEVER
      }
      return parsed
    })
])

const ImportedMcpServerSchema = z
  .object({
    name: z.string().min(1).optional(),
    type: LegacyMcpServerTypeSchema.optional(),
    description: z.string().optional(),
    url: z.string().optional(),
    baseUrl: z.string().optional(),
    command: z.string().optional(),
    registryUrl: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    headers: z.record(z.string(), z.string()).optional(),
    provider: z.string().optional(),
    providerUrl: z.string().optional(),
    logoUrl: z.string().optional(),
    tags: z.array(z.string()).optional(),
    longRunning: z.boolean().optional(),
    timeout: ImportedTimeoutSchema.optional(),
    dxtVersion: z.string().optional(),
    dxtPath: z.string().optional(),
    reference: z.string().optional(),
    searchKey: z.string().optional(),
    configSample: McpConfigSampleSchema.optional(),
    disabledTools: z.array(z.string()).optional(),
    disabledAutoApproveTools: z.array(z.string()).optional(),
    shouldConfig: z.boolean().optional(),
    sortOrder: z.number().optional(),
    isActive: z.boolean().optional()
  })
  .strip()

type ImportedMcpServer = z.infer<typeof ImportedMcpServerSchema>

const NamedImportedMcpServerSchema = ImportedMcpServerSchema.extend({
  name: z.string().min(1)
}).transform((server, ctx): CreateMcpServerDto => {
  const preset = getMcpServerPreset(server.name)
  const baseUrl = server.baseUrl ?? server.url
  const requestedType = normalizeImportedMcpServerType(server.type)

  if (server.type === 'inMemory' && !preset) {
    ctx.addIssue({
      code: 'custom',
      path: ['type'],
      message: `Legacy inMemory type is only valid for a known built-in MCP server: ${server.name}`
    })
    return z.NEVER
  }

  if (requestedType === 'inProcess' && !preset) {
    ctx.addIssue({
      code: 'custom',
      path: ['type'],
      message: `inProcess type is only valid for a known built-in MCP server: ${server.name}`
    })
    return z.NEVER
  }

  const usePresetConnection =
    preset !== undefined &&
    (server.type === 'inMemory' ||
      requestedType === 'inProcess' ||
      (server.type === undefined && !server.command?.trim() && !baseUrl?.trim()))
  const type = usePresetConnection ? preset.type : (requestedType ?? inferMcpServerType(server))

  if (!type) {
    ctx.addIssue({
      code: 'custom',
      message: `MCP server ${server.name} must provide a command, URL, or recognized built-in type`
    })
    return z.NEVER
  }

  const resolvedBaseUrl = usePresetConnection ? preset.baseUrl : baseUrl
  const resolvedCommand = usePresetConnection ? preset.command : server.command

  if (type === 'stdio' && !resolvedCommand?.trim()) {
    ctx.addIssue({
      code: 'custom',
      path: ['command'],
      message: `stdio MCP server ${server.name} must provide a command`
    })
    return z.NEVER
  }
  if ((type === 'sse' || type === 'streamableHttp') && !resolvedBaseUrl?.trim()) {
    ctx.addIssue({
      code: 'custom',
      path: ['baseUrl'],
      message: `${type} MCP server ${server.name} must provide a URL`
    })
    return z.NEVER
  }

  const normalized = {
    ...preset,
    ...server,
    name: server.name,
    type,
    baseUrl: resolvedBaseUrl,
    command: resolvedCommand,
    args: server.args ?? preset?.args,
    env: server.env ?? preset?.env,
    headers: preset ? { ...server.headers, ...preset.headers } : server.headers
  }

  delete normalized.url

  return CreateMcpServerSchema.parse(normalized)
})

const ImportedMcpServerMapSchema = z.record(z.string().min(1), ImportedMcpServerSchema)

/**
 * Accepts the MCP import shapes used by desktop clients and Cherry deep links:
 * a single item, an array, or an `mcpServers` name-to-config map.
 */
export const McpServerImportPayloadSchema = z
  .union([
    z
      .object({ mcpServers: ImportedMcpServerMapSchema })
      .transform(({ mcpServers }) =>
        Object.entries(mcpServers).map(([name, server]) => ({ ...server, name: server.name ?? name }))
      ),
    z.array(ImportedMcpServerSchema),
    ImportedMcpServerSchema.transform((server) => [server])
  ])
  .transform((servers, ctx): CreateMcpServerDto[] => {
    const result = z.array(NamedImportedMcpServerSchema).min(1).safeParse(servers)
    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message })
      }
      return z.NEVER
    }
    return result.data
  })

export type McpServerImportPayload = z.input<typeof McpServerImportPayloadSchema>

export function normalizeMcpServerImportPayload(input: unknown): CreateMcpServerDto[] {
  return McpServerImportPayloadSchema.parse(input)
}

export function safeNormalizeMcpServerImportPayload(input: unknown) {
  return McpServerImportPayloadSchema.safeParse(input)
}

export function getMcpServerType(url: string): Extract<McpServerType, 'sse' | 'streamableHttp'> {
  return url.endsWith('/mcp') ? 'streamableHttp' : 'sse'
}

function normalizeImportedMcpServerType(type: string | undefined): McpServerType | undefined {
  if (type === undefined) return undefined
  if (type === 'inMemory') return 'inProcess'

  const parsed = McpServerTypeSchema.safeParse(type)
  if (parsed.success) return parsed.data

  return type.toLowerCase().includes('http') ? 'streamableHttp' : undefined
}

function inferMcpServerType(server: ImportedMcpServer): McpServerType | undefined {
  if (server.command?.trim()) return 'stdio'

  const url = server.baseUrl ?? server.url
  return url?.trim() ? getMcpServerType(url) : undefined
}
