import * as z from 'zod'

import type { McpRuntimeStatus } from '@shared/data/cache/cacheValueTypes'

const endpoint = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value)
    return /^https?:$/.test(url.protocol) && !url.username && !url.password
  }, 'HTTP or HTTPS endpoint without embedded credentials required')
const uarEndpoint = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value)
    return /^(https?|wss?):$/.test(url.protocol) && !url.username && !url.password
  }, 'HTTP(S) or WS(S) endpoint without embedded credentials required')
const model = z.object({ name: z.string().default(''), baseUrl: z.string().default('') })
const serviceOwnershipSchema = z.enum(['managed', 'external'])
const serviceSourceSchema = z.enum(['application', 'full-pack', 'manual'])
const serviceProfileSchema = (defaultEndpoint: string) =>
  z
    .object({
      ownership: serviceOwnershipSchema.default('managed'),
      source: serviceSourceSchema.default('application'),
      endpoint: endpoint.default(defaultEndpoint)
    })
    .superRefine((profile, context) => {
      if (profile.ownership === 'managed' && profile.source !== 'application') {
        context.addIssue({ code: 'custom', path: ['source'], message: 'Managed services must be application-owned' })
      }
      if (profile.ownership === 'external' && profile.source === 'application') {
        context.addIssue({ code: 'custom', path: ['source'], message: 'External services need external provenance' })
      }
    })
const compassConfigSchema = z.object({
  enabled: z.boolean().default(true),
  storage: z.enum(['automatic', 'remote', 'sqlite', 'json']).default('automatic'),
  endpoint: endpoint.default('http://127.0.0.1:28000'),
  namespace: z
    .string()
    .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/)
    .default('compass'),
  username: z
    .string()
    .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/)
    .default('compass'),
  authLevel: z.enum(['root', 'namespace', 'database']).default('namespace')
})
const filesystemConfigSchema = z.object({
  enabled: z.boolean().default(true),
  allowWrite: z.boolean().default(false),
  additionalRoots: z
    .array(z.string())
    .transform((roots) => roots.map((root) => root.trim()).filter(Boolean))
    .default([])
})
export const uarStorageConfigSchema = z.object({
  backend: z.enum(['embedded', 'remote']).default('embedded'),
  endpoint: uarEndpoint.default('http://127.0.0.1:28000'),
  namespace: z
    .string()
    .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/)
    .default('uar'),
  database: z
    .string()
    .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/)
    .default('main'),
  username: z
    .string()
    .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/)
    .default('uar'),
  authLevel: z.enum(['root', 'namespace', 'database']).default('namespace')
})
export type UarStorageConfig = z.infer<typeof uarStorageConfigSchema>
const servicesConfigSchema = z.object({
  surrealdb: serviceProfileSchema('http://127.0.0.1:28000').prefault({}),
  memory: serviceProfileSchema('http://127.0.0.1:23001/mcp/sse').prefault({}),
  liter: serviceProfileSchema('http://127.0.0.1:4000').prefault({}),
  surrealPort: z.number().int().min(1).max(65535).default(28000),
  memoryPort: z.number().int().min(1).max(65535).default(23001),
  literPort: z.number().int().min(1).max(65535).default(4000),
  memoryEnabled: z.boolean().default(false),
  judge: model.prefault({}),
  critic: model.prefault({})
})

export const integrationConfigSchema = z.object({
  compass: compassConfigSchema.prefault({}),
  filesystem: filesystemConfigSchema.prefault({}),
  uar: uarStorageConfigSchema.prefault({}),
  services: servicesConfigSchema.prefault({})
})
export type IntegrationConfig = z.infer<typeof integrationConfigSchema>

export const integrationFeatureSchema = z.enum(['compass', 'filesystem', 'uar', 'services'])
export type IntegrationFeature = z.infer<typeof integrationFeatureSchema>
export const integrationRevisionsSchema = z.object({
  compass: z.number().int().nonnegative().default(0),
  filesystem: z.number().int().nonnegative().default(0),
  uar: z.number().int().nonnegative().default(0),
  services: z.number().int().nonnegative().default(0)
})
export type IntegrationRevisions = z.infer<typeof integrationRevisionsSchema>
export const integrationDocumentSchema = z.object({
  schemaVersion: z.literal(4),
  revisions: integrationRevisionsSchema,
  config: integrationConfigSchema
})
export type IntegrationDocument = z.infer<typeof integrationDocumentSchema>

export const integrationUpdateSchema = z.discriminatedUnion('feature', [
  z
    .object({
      feature: z.literal('compass'),
      expectedRevision: z.number().int().nonnegative(),
      value: compassConfigSchema
    })
    .strict(),
  z
    .object({
      feature: z.literal('filesystem'),
      expectedRevision: z.number().int().nonnegative(),
      value: filesystemConfigSchema
    })
    .strict(),
  z
    .object({
      feature: z.literal('services'),
      expectedRevision: z.number().int().nonnegative(),
      value: servicesConfigSchema
    })
    .strict(),
  z
    .object({
      feature: z.literal('uar'),
      expectedRevision: z.number().int().nonnegative(),
      value: uarStorageConfigSchema
    })
    .strict()
])
export type IntegrationUpdate = z.infer<typeof integrationUpdateSchema>
export const secretNames = [
  'rootPassword',
  'memoryPassword',
  'compassPassword',
  'uarPassword',
  'memoryToken',
  'literKey',
  'judgeKey',
  'criticKey'
] as const
export type IntegrationSecret = (typeof secretNames)[number]
const secretMutationSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('unchanged') }).strict(),
  z.object({ operation: z.literal('set'), value: z.string().min(1).max(16384) }).strict(),
  z.object({ operation: z.literal('clear') }).strict()
])
export const secretPatchSchema = z.partialRecord(z.enum(secretNames), secretMutationSchema)
export type IntegrationSecretPatch = z.infer<typeof secretPatchSchema>
export const integrationActionSchema = z.enum([
  'pull',
  'start',
  'stop',
  'restart',
  'status',
  'logs',
  'index',
  'refresh',
  'install-skills',
  'repair-path',
  'diagnose',
  'uar-check',
  'uar-apply',
  'uar-restart',
  'discover-services'
])
export type IntegrationAction = z.infer<typeof integrationActionSchema>
export type IntegrationDiagnostic = {
  id: string
  state: 'operational' | 'listening' | 'authenticated' | 'failed' | 'disabled'
  detail?: string
}
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
export type IntegrationService = 'surrealdb' | 'memory' | 'liter'
export type ServiceProvenance = {
  source: z.infer<typeof serviceSourceSchema>
  ownership: z.infer<typeof serviceOwnershipSchema>
  label: string
  markers: string[]
  sourceVersion?: string
  configPath?: string
}
export type ServiceCandidate = {
  id: string
  service: IntegrationService
  endpoint: string
  provenance: ServiceProvenance[]
}
export type ServiceDiscovery = { candidates: ServiceCandidate[]; errors: string[] }
export type IntegrationSnapshot = {
  config: IntegrationConfig
  schemaVersion: 4
  revisions: IntegrationRevisions
  secrets: Partial<Record<IntegrationSecret, boolean>>
  operations: IntegrationOperation[]
  workspaces: WorkspaceIntegration[]
  commandDirectory: string
  serviceDirectory: string
  pathInstalled: boolean
  servers: { id: string; name: string; workspace?: string; binary?: string; status: McpRuntimeStatus['state'] }[]
  inventory: { revision: string; skills: string[]; tools: Record<string, string> } | null
  serviceDiscovery: ServiceDiscovery
  uar: {
    state: 'running' | 'stopped' | 'unavailable'
    binary?: string
    binaryVersion?: string
    runtimeVersion?: string
    capabilities: string[]
    requestedBackend: 'embedded' | 'remote'
    effectiveBackend: 'embedded' | 'remote'
    requestedRevision: number
    effectiveRevision: number
    applyRequired: boolean
    endpoint?: string
    namespace?: string
    database?: string
    authLevel?: 'root' | 'namespace' | 'database'
    lastApplyError?: string
  }
}
