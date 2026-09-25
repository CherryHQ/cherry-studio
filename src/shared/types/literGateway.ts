import * as z from 'zod'

const identifier = z.string().trim().min(1).max(256)
const connectionIdentifier = z
  .string()
  .trim()
  .regex(/^[a-zA-Z0-9_.:-]+$/)
  .max(128)
const endpoint = z
  .string()
  .url()
  .refine((value) => {
    const parsed = new URL(value)
    return /^https?:$/.test(parsed.protocol) && !parsed.username && !parsed.password
  }, 'HTTP or HTTPS endpoint without embedded credentials required')

export const literProviderIdentitySchema = z.object({ providerId: identifier }).strict()
export type LiterProviderIdentity = z.infer<typeof literProviderIdentitySchema>

export const literModelIdentitySchema = z
  .object({ providerId: identifier, modelId: identifier })
  .strict()
export type LiterModelIdentity = z.infer<typeof literModelIdentitySchema>

export const literProviderConnectionIdentitySchema = z
  .object({ providerConnectionId: connectionIdentifier })
  .strict()
export type LiterProviderConnectionIdentity = z.infer<typeof literProviderConnectionIdentitySchema>

export const literGatewayConnectionIdentitySchema = z
  .object({ gatewayConnectionId: connectionIdentifier })
  .strict()
export type LiterGatewayConnectionIdentity = z.infer<typeof literGatewayConnectionIdentitySchema>

export const literResolvedModelIdentitySchema = z
  .object({ providerConnectionId: connectionIdentifier, providerId: identifier, modelId: identifier })
  .strict()
export type LiterResolvedModelIdentity = z.infer<typeof literResolvedModelIdentitySchema>

export const literServedAliasIdentitySchema = z
  .object({ gatewayConnectionId: connectionIdentifier, alias: identifier })
  .strict()
export type LiterServedAliasIdentity = z.infer<typeof literServedAliasIdentitySchema>

export function literModelIdentityKey(identity: LiterModelIdentity): string {
  return JSON.stringify([identity.providerId, identity.modelId])
}

export function literResolvedModelIdentityKey(identity: LiterResolvedModelIdentity): string {
  return JSON.stringify([identity.providerConnectionId, identity.providerId, identity.modelId])
}

export const literCredentialMutationSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('unchanged') }).strict(),
  z.object({ operation: z.literal('set'), value: z.string().min(1).max(16384) }).strict(),
  z.object({ operation: z.literal('clear') }).strict()
])
export type LiterCredentialMutation = z.infer<typeof literCredentialMutationSchema>

export const literConnectionConfigSchema = z
  .object({
    providerConnectionId: connectionIdentifier,
    providerId: identifier,
    displayName: z.string().trim().min(1).max(256),
    baseUrl: endpoint.optional(),
    timeoutMs: z.number().int().min(1000).max(600_000).default(60_000),
    enabled: z.boolean().default(true)
  })
  .strict()
export type LiterConnectionConfig = z.infer<typeof literConnectionConfigSchema>

export const literAliasConfigSchema = z
  .object({
    gatewayConnectionId: connectionIdentifier,
    alias: identifier,
    target: literResolvedModelIdentitySchema,
    displayName: z.string().trim().min(1).max(256).optional(),
    enabled: z.boolean().default(true),
    custom: z.boolean().default(false)
  })
  .strict()
export type LiterAliasConfig = z.infer<typeof literAliasConfigSchema>

export const literConnectionMutationSchema = z
  .object({
    mode: z.enum(['create', 'update']),
    expectedRevision: z.number().int().nonnegative(),
    connection: literConnectionConfigSchema,
    credential: literCredentialMutationSchema
  })
  .strict()
export type LiterConnectionMutation = z.infer<typeof literConnectionMutationSchema>

export const literAliasMutationSchema = z
  .object({
    mode: z.enum(['create', 'update']),
    expectedRevision: z.number().int().nonnegative(),
    alias: literAliasConfigSchema
  })
  .strict()
export type LiterAliasMutation = z.infer<typeof literAliasMutationSchema>

export const literGatewaySelectionSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('discovered'),
      expectedRevision: z.number().int().nonnegative(),
      candidateId: z.string().min(1).max(4096),
      source: z.enum(['application', 'full-pack', 'manual']),
      ownership: z.enum(['managed', 'external'])
    })
    .strict(),
  z
    .object({
      kind: z.literal('manual'),
      expectedRevision: z.number().int().nonnegative(),
      endpoint
    })
    .strict()
])
export type LiterGatewaySelection = z.infer<typeof literGatewaySelectionSchema>

export type LiterModelCapabilities = {
  vision: boolean
  reasoning: boolean
  structuredOutput: boolean
  functionCalling: boolean
  audioInput: boolean
  audioOutput: boolean
}

export type LiterCatalogModel = {
  identity: LiterModelIdentity
  name: string
  mode?: string
  contextWindow?: number
  maxOutputTokens?: number
  capabilities: LiterModelCapabilities
}

export type LiterCatalogProvider = {
  identity: LiterProviderIdentity
  name: string
  baseUrl?: string
  auth?: { type: string; environmentVariable?: string }
  endpoints: string[]
  capabilities: LiterModelCapabilities
  models: LiterCatalogModel[]
}

export type LiterConnection = LiterConnectionConfig & {
  identity: LiterProviderConnectionIdentity
  credentialConfigured: boolean
  knownProvider: boolean
}

export type LiterServedAlias = {
  identity: LiterServedAliasIdentity
  target?: LiterResolvedModelIdentity
  displayName: string
  enabled: boolean
  available: boolean
  custom: boolean
  reconciliation: 'resolved' | 'unresolved'
  source: 'configured' | 'live' | 'configured-and-live'
}

export type LiterGatewayCatalogSnapshot = {
  schemaVersion: 1
  revision: number
  gateway: {
    identity: LiterGatewayConnectionIdentity
    selectedCandidateId?: string
    endpoint: string
    ownership: 'managed' | 'external'
    operational: boolean
    error?: string
    candidates: Array<{
      id: string
      endpoint: string
      source: 'application' | 'full-pack' | 'manual'
      ownership: 'managed' | 'external'
      label: string
      selected: boolean
    }>
  }
  catalog: {
    repository: string
    revision: string
    providersSha256: string
    catalogSha256: string
  }
  providers: LiterCatalogProvider[]
  connections: LiterConnection[]
  aliases: LiterServedAlias[]
}
