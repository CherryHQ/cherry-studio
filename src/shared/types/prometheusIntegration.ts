import * as z from 'zod'

import type { McpRuntimeStatus } from '@shared/data/cache/cacheValueTypes'

import type { IntegrationDiagnostic, IntegrationOperation } from './integrationOperation'
import { literAliasConfigSchema, literConnectionConfigSchema } from './literGateway'
import { literRoleAssignmentsSchema } from './literRoles'

export {
  integrationActionSchema,
  type IntegrationAction,
  type IntegrationDiagnostic,
  type IntegrationOperation,
  type IntegrationOperationEvent,
  type IntegrationOperationEventPage,
  type IntegrationOperationLogExport,
  type IntegrationOperationLogPage,
  type IntegrationOperationProgress,
  type IntegrationOperationStage,
  type IntegrationOperationStatus
} from './integrationOperation'

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
const servicesConfigSchema = z
  .object({
    surrealdb: serviceProfileSchema('http://127.0.0.1:28000').prefault({}),
    memory: serviceProfileSchema('http://127.0.0.1:23001/mcp/sse').prefault({}),
    liter: serviceProfileSchema('http://127.0.0.1:4000').prefault({}),
    surrealPort: z.number().int().min(1).max(65535).default(28000),
    memoryPort: z.number().int().min(1).max(65535).default(23001),
    literPort: z.number().int().min(1).max(65535).default(4000),
    memoryEnabled: z.boolean().default(false),
    literConnections: z.array(literConnectionConfigSchema).max(256).default([]),
    literAliases: z.array(literAliasConfigSchema).max(2048).default([]),
    literRoles: literRoleAssignmentsSchema.optional(),
    judge: model.prefault({}),
    critic: model.prefault({})
  })
  .superRefine((services, context) => {
    const connections = new Map(
      services.literConnections.map((connection) => [connection.providerConnectionId, connection])
    )
    if (connections.size !== services.literConnections.length) {
      context.addIssue({ code: 'custom', path: ['literConnections'], message: 'Connection IDs must be unique' })
    }
    const aliases = new Set<string>()
    for (const [index, alias] of services.literAliases.entries()) {
      const aliasKey = JSON.stringify([alias.gatewayConnectionId, alias.alias])
      if (aliases.has(aliasKey)) {
        context.addIssue({ code: 'custom', path: ['literAliases', index, 'alias'], message: 'Aliases must be unique' })
      }
      aliases.add(aliasKey)
      const connection = connections.get(alias.target.providerConnectionId)
      if (!connection || connection.providerId !== alias.target.providerId) {
        context.addIssue({
          code: 'custom',
          path: ['literAliases', index, 'target'],
          message: 'Alias target must reference a matching provider connection'
        })
      }
    }
    if (services.literRoles) {
      for (const role of ['critic', 'judge', 'backup'] as const) {
        const assignment = services.literRoles[role]
        const configuredAlias = services.literAliases.find(
          (alias) =>
            alias.gatewayConnectionId === assignment.servedAlias.gatewayConnectionId &&
            alias.alias === assignment.servedAlias.alias
        )
        if (
          !configuredAlias ||
          configuredAlias.target.providerConnectionId !== assignment.model.providerConnectionId ||
          configuredAlias.target.providerId !== assignment.model.providerId ||
          configuredAlias.target.modelId !== assignment.model.modelId
        ) {
          context.addIssue({
            code: 'custom',
            path: ['literRoles', role],
            message: 'Role assignment must reference a resolved configured alias'
          })
        }
      }
    }
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

const uarAdministrationGroupSchema = z.enum(['runtime', 'agents', 'experience', 'administration'])
const uarAdministrationScopeSchema = z.enum(['public', 'admin', 'owner', 'host'])
export const uarAdministrationApplySchema = z.enum([
  'read',
  'live',
  'next_turn',
  'restart',
  'host_controlled',
  'unavailable'
])
const uarAdministrationAvailabilitySchema = z.enum(['available', 'host_controlled', 'feature_gated', 'retired'])
const uarAdministrationMethodSchema = z.object({
  id: z.string().min(1),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'ANY']),
  path: z.string().startsWith('/'),
  scope: uarAdministrationScopeSchema,
  apply: uarAdministrationApplySchema
})
const uarAdministrationSurfaceSchema = z.object({
  id: z.string().min(1),
  group: uarAdministrationGroupSchema,
  availability: uarAdministrationAvailabilitySchema,
  methods: z.array(uarAdministrationMethodSchema)
})
export const uarAdministrationCapabilitiesSchema = z.object({
  schema_version: z.literal(2),
  scopes: z.tuple([z.literal('public'), z.literal('admin'), z.literal('owner'), z.literal('host')]),
  surfaces: z.array(uarAdministrationSurfaceSchema)
})
export const uarCapabilitiesResponseSchema = z.object({
  uar_version: z.string().min(1),
  agui: z.object({ profile: z.literal('uar.agui/1'), profile_revision: z.literal(1) }),
  capabilities: z.array(z.string()),
  administration: uarAdministrationCapabilitiesSchema
})
export type UarAdministrationCapabilities = z.infer<typeof uarAdministrationCapabilitiesSchema>
export type UarAdministrationMethod = z.infer<typeof uarAdministrationMethodSchema>
export type UarAdministrationSurface = z.infer<typeof uarAdministrationSurfaceSchema>
export type UarAdministrationScope = z.infer<typeof uarAdministrationScopeSchema>
export type UarAdministrationSnapshot = {
  schemaVersion: 1
  uarVersion: string
  generation: number
  surfaces: Array<
    Omit<UarAdministrationSurface, 'methods'> & {
      methods: Array<UarAdministrationMethod & { adapter: 'available' | 'unavailable' }>
    }
  >
}

export type UarAuthorityDiagnosticResult = {
  schemaVersion: 1
  generation: number
  diagnostics: IntegrationDiagnostic[]
}

export type UarAdministrationOwner = {
  sessionId: string
  sessionName: string
  agentId: string
  agentName: string
}

export type UarRunInspection = {
  runId: string
  ownerSessionId: string
  agentId: string
  conversationId?: string
  status: 'pending' | 'running' | 'paused' | 'done' | 'error' | 'cancelled'
  agentRevision?: string
  effectiveModel?: unknown
  effectivePolicy?: unknown
  presentationSelection?: unknown
}

export type UarKnowledgeBaseInspection = {
  ownerSessionId: string
  id: string
  name: string
  description?: string
  documentCount: number
  embeddingProvider: string
  embeddingModel: string
  updatedAt: string
  documents: Array<{
    id: string
    filename: string
    status: string
    chunkCount: number
    error?: string
  }>
}

export type UarMemoryInspection = {
  id: string
  content: string
  scope: string
  userId?: string
  agentId?: string
  sessionId?: string
  importance?: number
  createdAt?: string
}

export type UarApprovalLifecycleInspection = {
  admissionId: string
  invocationId: string
  eventId?: string
  cursor?: number
  rootRunId: string
  executingRunId: string
  ownerSessionId: string
  workspace: string
  toolName: string
  state:
    | 'prepared'
    | 'awaiting-human'
    | 'awaiting-ack'
    | 'authorized'
    | 'claimed'
    | 'succeeded'
    | 'failed'
    | 'denied'
    | 'cancelled'
    | 'invalidated'
    | 'interrupted'
    | 'outcome-unknown'
  hostDisposition: 'auto' | 'ask' | 'deny'
  action: {
    operation?: string
    server?: string
    target?: string
    detailsAvailable: boolean
    riskReason?: string
  }
  updatedAt: number
}

export type UarOperationalSnapshot = {
  schemaVersion: 1
  generation: number
  owners: UarAdministrationOwner[]
  runs: UarRunInspection[]
  knowledgeBases: UarKnowledgeBaseInspection[]
  memory: { enabled: boolean; total: number; items: UarMemoryInspection[] }
  approvals: UarApprovalLifecycleInspection[]
  tools: {
    total: number
    names: string[]
    mcpServers: Array<{ name: string; status: string; toolCount: number }>
    hostControlled: boolean
  }
  security: {
    governance: 'enabled' | 'disabled' | 'unavailable'
    credentialProvidersBySession: Record<string, string[]>
  }
  protocols: {
    a2a: 'available' | 'unavailable'
    acp: 'available' | 'unavailable'
    federatedAgents: Array<{ id: string; name: string; baseUrl: string; capabilities: string[] }>
    federatedSkills: number
  }
  failures: Array<{ surface: string; message: string }>
}

export type UarRunDetailSnapshot = {
  schemaVersion: 1
  generation: number
  run: UarRunInspection
  checkpoints: Array<{
    id: string
    nodeId: string
    iteration: number
    createdAt: string
    completeness: 'complete' | 'incomplete_legacy'
  }>
  context: {
    agentConfig?: unknown
    effectiveConfig?: unknown
    contextStats?: unknown
    promptCaching?: unknown
    conversationPolicy?: unknown
  }
}

export const uarKnowledgeCreateSchema = z
  .object({
    sessionId: z.string().min(1),
    name: z.string().trim().min(1).max(160),
    description: z.string().trim().max(1000).optional()
  })
  .strict()

export const uarKnowledgeSearchSchema = z
  .object({
    sessionId: z.string().min(1),
    knowledgeBaseId: z.string().min(1),
    query: z.string().trim().min(1).max(4000)
  })
  .strict()

export type UarKnowledgeSearchResult = {
  content: string
  score: number
  documentId?: string
}

export type UarKnowledgeUploadResult = {
  cancelled: boolean
  filename?: string
  snapshot: UarOperationalSnapshot
}

export const uarMemoryCreateSchema = z
  .object({ content: z.string().trim().min(1).max(32_000), userId: z.string().trim().optional() })
  .strict()

export const uarSettingsNamespaceSchema = z.enum([
  'server',
  'security',
  'resilience',
  'persistence',
  'file-processing',
  'vision',
  'models',
  'knowledge-bases',
  'intent-classifier',
  'providers',
  'llm',
  'unstructured',
  'kreuzberg',
  'context-management',
  'context-strategy',
  'prompt-caching',
  'rag',
  'governance',
  'agent-config',
  'skill-config',
  'mistral-ocr',
  'memory',
  'llm-failover',
  'sandbox',
  'native-tools',
  'skill-evolution',
  'sycophancy',
  'acp'
])
export type UarSettingsNamespace = z.infer<typeof uarSettingsNamespaceSchema>
export type UarSettingApply = 'live' | 'next_turn' | 'restart'
export type UarSettingState = {
  key: string
  field: string
  saved: unknown
  effective: unknown
  revision: string
  source: string
  drift: boolean
  apply: UarSettingApply
  applicationStatus: 'effective' | 'pending' | 'restart_required'
}
export type UarSettingsSnapshot = {
  schemaVersion: 1
  namespace: UarSettingsNamespace
  generation: number
  settings: UarSettingState[]
}
export type UarSettingChange = { field: string; value: unknown; expectedRevision: string }
export type UarSettingsUpdateResult = {
  status: 'updated' | 'partial'
  namespace: UarSettingsNamespace
  generation: number
  updated: UarSettingState[]
  errors: Array<{
    key: string
    code: string
    message?: string
    expectedRevision?: string
    currentRevision?: string
  }>
}

export type UarAgentOrigin = {
  kind: string
  id: string
  revision?: string
}
export type UarAgentCatalogItem = {
  id: string
  title: string
  description: string
  version: string
  revision: string
  origin: UarAgentOrigin
  provider: string
  model: string
  fallbackModels: Array<{ provider: string; model: string }>
  skillIds: string[]
  bossAgent?: { id: string; name: string; modelId?: string }
  definition: Record<string, unknown>
}
export type UarFederatedAgent = {
  id: string
  name: string
  description: string
  baseUrl: string
  capabilities: string[]
  updatedAt: string
}
export type UarSkillCatalogItem = {
  id: string
  title: string
  description: string
  version: string
  enabled: boolean
  origin: string
  providerId: string
}
export type UarCatalogSnapshot = {
  schemaVersion: 1
  generation: number
  agents: UarAgentCatalogItem[]
  federatedAgents: UarFederatedAgent[]
  skills: UarSkillCatalogItem[]
  skillProvenance: {
    loadedSkillCount: number
    packSkillCount?: number
    revision?: string
    drift?: string
  }
}
export const uarAgentRunTargetSchema = z
  .object({
    agentId: z.string().min(1).max(256),
    bossModelId: z.string().min(1).max(512).optional()
  })
  .strict()
export type UarAgentRunTargetInput = z.infer<typeof uarAgentRunTargetSchema>
export type UarAgentRunTarget = {
  bossAgentId: string
  catalogAgentId: string
  catalogRevision: string
  created: boolean
  effectiveModel: {
    source: 'uar'
    providerId: string
    modelId: string
    identity: string
  }
  presentation: UarPresentationSelection
}
export const uarAgentSaveSchema = z
  .object({
    mode: z.enum(['create', 'replace']),
    id: z.string().min(1).max(256),
    expectedRevision: z.string().min(1).max(256).optional(),
    definition: z.record(z.string(), z.unknown())
  })
  .strict()
export type UarAgentSave = z.infer<typeof uarAgentSaveSchema>
export const uarCompilerRequestSchema = z
  .object({
    content: z.string().min(1).max(1_000_000),
    register: z.boolean(),
    replace: z.boolean().default(false),
    expectedRevision: z.string().min(1).max(256).optional()
  })
  .strict()
export type UarCompilerRequest = z.infer<typeof uarCompilerRequestSchema>
export type UarCompilerResult = {
  registered: boolean
  artifact?: UarAgentCatalogItem
  descriptor: Record<string, unknown>
  signature: string
  report: {
    id: string
    agentId: string
    version: string
    overall: 'pass' | 'fail' | 'skip'
    totalDurationMs: number
    stages: Array<{
      stage: number
      name: string
      outcome: 'pass' | 'fail' | 'skip'
      durationMs: number
      diagnostics: Array<{ level: 'error' | 'warning' | 'info'; message: string; section?: string }>
    }>
  }
  verification: {
    valid: boolean
    agentId: string
    contentHash: string
    signerPublicKey: string
  }
}
export const uarFederatedAgentSaveSchema = z
  .object({
    id: z.string().min(1).max(256).optional(),
    name: z.string().min(1).max(256),
    description: z.string().max(4096),
    baseUrl: endpoint,
    capabilities: z.array(z.string().min(1).max(256)).max(512)
  })
  .strict()
export type UarFederatedAgentSave = z.infer<typeof uarFederatedAgentSaveSchema>
export const uarAgentSkillsSchema = z
  .object({ agentId: z.string().min(1).max(256), skillIds: z.array(z.string().min(1).max(256)).max(1024) })
  .strict()
export const uarSkillToggleSchema = z.object({ skillId: z.string().min(1).max(256), enabled: z.boolean() }).strict()

export const uarPresentationSelectionSchema = z
  .object({
    mode: z.enum(['inherit', 'auto', 'all', 'none', 'selected']),
    ids: z.array(z.string().min(1).max(256)).max(1024),
    denied_ids: z.array(z.string().min(1).max(256)).max(1024)
  })
  .strict()
export type UarPresentationSelection = z.infer<typeof uarPresentationSelectionSchema>
export type UarPresentationTemplate = {
  version: string
  catalog_id: string
  components: Array<Record<string, unknown>>
  default_data: Record<string, unknown>
}
export type UarPresentation = {
  id: string
  ownerId: string
  revision: number
  title: string
  description: string
  enabled: boolean
  template: UarPresentationTemplate
  createdAt: string
  updatedAt: string
}
export type UarArtifactSchema = {
  schemaId: string
  title: string
  description: string
  artifactType: 'form' | 'confirm' | 'select' | 'text_input' | 'display' | 'chart' | 'media'
  jsonSchema: Record<string, unknown>
  renderHint?: string
  builtin: boolean
  revision?: string
}
export type UarA2uiComponent = {
  id: string
  title: string
  description?: string
  source: string
  category: string
  primitiveType: string
  revision: string
  builtin: boolean
}
export type UarPresentationAdministrationSnapshot = {
  schemaVersion: 1
  generation: number
  ownerId: string
  presentations: UarPresentation[]
  schemas: UarArtifactSchema[]
  components: UarA2uiComponent[]
  policy: UarPresentationSelection
  policyBaseline: Record<string, unknown>
}
export const uarPresentationSaveSchema = z
  .object({
    id: z.string().min(1).max(256).optional(),
    expectedRevision: z.number().int().nonnegative().optional(),
    title: z.string().min(1).max(256),
    description: z.string().max(4096),
    enabled: z.boolean(),
    template: z.record(z.string(), z.unknown())
  })
  .strict()
export type UarPresentationSave = z.infer<typeof uarPresentationSaveSchema>
export const uarArtifactSchemaSaveSchema = z
  .object({
    mode: z.enum(['create', 'update']),
    schemaId: z.string().min(1).max(256),
    expectedRevision: z.string().min(1).max(128).optional(),
    title: z.string().min(1).max(256),
    description: z.string().max(4096),
    artifactType: z.enum(['form', 'confirm', 'select', 'text_input', 'display', 'chart', 'media']),
    jsonSchema: z.record(z.string(), z.unknown()),
    renderHint: z.string().max(128).optional()
  })
  .strict()
export type UarArtifactSchemaSave = z.infer<typeof uarArtifactSchemaSaveSchema>
export const uarA2uiComponentSaveSchema = z
  .object({
    id: z.string().min(1).max(256).optional(),
    expectedRevision: z.string().min(1).max(128).optional(),
    title: z.string().min(1).max(256),
    description: z.string().max(4096).optional(),
    source: z.string().min(1).max(1_000_000)
  })
  .strict()
export type UarA2uiComponentSave = z.infer<typeof uarA2uiComponentSaveSchema>
export type UarModelSource = 'boss' | 'gateway' | 'uar'
export type UarModelSourceSnapshot = {
  schemaVersion: 1
  generation: number
  sources: Array<{
    source: UarModelSource
    instanceId: string
    instanceName: string
    connectedInstance: string
    operational: boolean
    error?: string
    providers: Array<{
      id: string
      name: string
      credentialConfigured: boolean
      enabled: boolean
      baseUrl?: string
      protocol?: 'auto' | 'chat' | 'responses'
      defaultModel?: string
      isDefault?: boolean
      models: Array<{
        id: string
        name: string
        enabled: boolean
        effectiveIdentity: string
        contextWindow?: number
        supportsVision?: boolean
        supportsTools?: boolean
        supportsReasoning?: boolean
        supportsStructuredOutput?: boolean
        supportsStreaming?: boolean
        maxOutputTokens?: number
      }>
    }>
  }>
  consumers: Array<{
    id: 'agent-inference' | 'knowledge-embeddings' | 'vision' | 'intent-classifier' | 'mistral-ocr' | 'memory'
    state: 'configurable' | 'local' | 'disabled' | 'unavailable'
    effectiveIdentity?: string
    sources: UarModelSource[]
    detail: string
  }>
}
export const uarProviderModelInputSchema = z
  .object({
    id: z.string().min(1).max(256),
    displayName: z.string().max(256).optional(),
    contextWindow: z.number().int().positive().optional(),
    supportsVision: z.boolean().optional(),
    supportsTools: z.boolean().optional(),
    supportsReasoning: z.boolean().optional(),
    supportsStructuredOutput: z.boolean().optional(),
    supportsStreaming: z.boolean().optional(),
    maxOutputTokens: z.number().int().positive().optional(),
    enabled: z.boolean().default(true)
  })
  .strict()
export const uarProviderSecretMutationSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('unchanged') }).strict(),
  z.object({ operation: z.literal('set'), value: z.string().min(1).max(16384) }).strict(),
  z.object({ operation: z.literal('clear') }).strict()
])
export const uarProviderMutationSchema = z
  .object({
    mode: z.enum(['create', 'update']),
    id: z
      .string()
      .regex(/^[a-zA-Z0-9_.:-]+$/)
      .max(128),
    displayName: z.string().min(1).max(256),
    baseUrl: z.union([z.literal(''), endpoint]),
    protocol: z.enum(['auto', 'chat', 'responses']),
    defaultModel: z.string().min(1).max(256).optional(),
    models: z.array(uarProviderModelInputSchema).max(512),
    enabled: z.boolean(),
    credential: uarProviderSecretMutationSchema
  })
  .strict()
export type UarProviderMutation = z.infer<typeof uarProviderMutationSchema>
export type CompassFreshnessState = 'unknown' | 'checking' | 'current' | 'stale' | 'missing' | 'error'
export type CompassFreshness = {
  state: CompassFreshnessState
  checkedAt?: number
  detail?: string
}
export type WorkspaceIntegration = {
  path: string
  id: string
  graph: string
  backend: 'remote' | 'sqlite' | 'json'
  serverIds: string[]
  enabled: boolean
  indexed: boolean
  freshness: CompassFreshness
  lastIndexedAt?: number
  latestOperationId?: string
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
