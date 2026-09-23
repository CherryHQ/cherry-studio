import * as z from 'zod'
import type { McpRuntimeStatus } from '@shared/data/cache/cacheValueTypes'

const endpoint = z.string().url().refine((value) => {
  const url = new URL(value)
  return /^https?:$/.test(url.protocol) && !url.username && !url.password
}, 'HTTP or HTTPS endpoint without embedded credentials required')
const model = z.object({ name: z.string().default(''), baseUrl: z.string().default('') })
export const integrationConfigSchema = z.object({
  compass: z.object({
    enabled: z.boolean().default(true),
    storage: z.enum(['automatic', 'remote', 'sqlite', 'json']).default('automatic'),
    endpoint: endpoint.default('http://127.0.0.1:28000'),
    namespace: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/).default('compass'),
    username: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/).default('compass'),
    authLevel: z.enum(['root', 'namespace', 'database']).default('namespace')
  }).prefault({}),
  filesystem: z.object({
    enabled: z.boolean().default(true),
    allowWrite: z.boolean().default(false),
    additionalRoots: z.array(z.string()).transform((roots) => roots.map((root) => root.trim()).filter(Boolean)).default([])
  }).prefault({}),
  services: z.object({
    mode: z.enum(['managed', 'external']).default('managed'),
    surrealPort: z.number().int().min(1).max(65535).default(28000),
    memoryPort: z.number().int().min(1).max(65535).default(23001),
    literPort: z.number().int().min(1).max(65535).default(4000),
    memoryEnabled: z.boolean().default(false),
    memoryEndpoint: endpoint.default('http://127.0.0.1:23001/mcp/sse'),
    literEndpoint: endpoint.default('http://127.0.0.1:4000'),
    judge: model.prefault({}),
    critic: model.prefault({})
  }).prefault({})
})
export type IntegrationConfig = z.infer<typeof integrationConfigSchema>
export const secretNames = ['rootPassword', 'memoryPassword', 'compassPassword', 'memoryToken', 'literKey', 'judgeKey', 'criticKey'] as const
export type IntegrationSecret = (typeof secretNames)[number]
export const secretPatchSchema = z.partialRecord(z.enum(secretNames), z.string().max(16384))
export const integrationActionSchema = z.enum(['pull', 'start', 'stop', 'restart', 'status', 'logs', 'index', 'refresh', 'install-skills', 'repair-path', 'diagnose'])
export type IntegrationAction = z.infer<typeof integrationActionSchema>
export type IntegrationDiagnostic = { id: string; state: 'operational' | 'listening' | 'authenticated' | 'failed' | 'disabled'; detail?: string }
export type IntegrationOperation = {
  id: string
  action: IntegrationAction
  workspacePath?: string
  status: 'running' | 'done' | 'failed' | 'cancelled'
  output: string
  error?: string
  startedAt: number
  diagnostics?: IntegrationDiagnostic[]
}
export type WorkspaceIntegration = {
  path: string
  id: string
  graph: string
  backend: 'remote' | 'sqlite' | 'json'
  serverIds: string[]
  indexed: boolean
  error?: string
}
export type IntegrationSnapshot = {
  config: IntegrationConfig
  secrets: Partial<Record<IntegrationSecret, boolean>>
  operations: IntegrationOperation[]
  workspaces: WorkspaceIntegration[]
  commandDirectory: string
  serviceDirectory: string
  pathInstalled: boolean
  servers: { id: string; name: string; workspace?: string; binary?: string; status: McpRuntimeStatus['state'] }[]
  inventory: { revision: string; skills: string[]; tools: Record<string, string> } | null
}
