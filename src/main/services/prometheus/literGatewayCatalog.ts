import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import * as z from 'zod'

import { application } from '@application'
import type {
  IntegrationConfig,
  ServiceCandidate,
  ServiceDiscovery
} from '@shared/types/prometheusIntegration'
import type {
  LiterCatalogModel,
  LiterCatalogProvider,
  LiterGatewayCatalogSnapshot,
  LiterModelCapabilities,
  LiterServedAlias
} from '@shared/types/literGateway'

import { readLiterConnectionCredentialPresence, readSecrets } from './integrationConfig'

const capabilitiesSchema = z
  .object({
    vision: z.boolean().optional(),
    reasoning: z.boolean().optional(),
    structured_output: z.boolean().optional(),
    function_calling: z.boolean().optional(),
    audio_in: z.boolean().optional(),
    audio_out: z.boolean().optional(),
    audio_input: z.boolean().optional(),
    audio_output: z.boolean().optional()
  })
  .passthrough()
const providerSchema = z
  .object({
    name: z.string().min(1),
    display_name: z.string().min(1),
    base_url: z.string().url().optional(),
    auth: z
      .object({ type: z.string().min(1), env_var: z.string().min(1).optional() })
      .passthrough()
      .optional(),
    endpoints: z.array(z.string()).default([]),
    capabilities: capabilitiesSchema
  })
  .passthrough()
const providersSchema = z.object({ providers: z.array(providerSchema) }).passthrough()
const catalogModelSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    mode: z.string().optional(),
    limit: z
      .object({
        context: z.number().int().nonnegative().optional(),
        output: z.number().int().nonnegative().optional()
      })
      .optional(),
    capabilities: capabilitiesSchema.optional()
  })
  .passthrough()
const catalogProviderSchema = z
  .object({ name: z.string().min(1), models: z.record(z.string(), catalogModelSchema) })
  .passthrough()
const catalogSchema = z
  .object({ providers: z.record(z.string(), catalogProviderSchema) })
  .passthrough()
const catalogManifestSchema = z
  .object({
    schema: z.literal(1),
    repository: z.string().min(1),
    revision: z.string().regex(/^[0-9a-f]{40}$/),
    providersSha256: z.string().regex(/^[0-9a-f]{64}$/),
    catalogSha256: z.string().regex(/^[0-9a-f]{64}$/)
  })
  .strict()
const liveModelsSchema = z
  .object({
    data: z.array(
      z
        .object({ id: z.string().min(1), owned_by: z.string().min(1).optional() })
        .passthrough()
    )
  })
  .passthrough()

type CatalogBundle = {
  metadata: z.infer<typeof catalogManifestSchema>
  providers: LiterCatalogProvider[]
  providerIds: Set<string>
  modelKeys: Set<string>
}

export type LiterLiveModel = z.infer<typeof liveModelsSchema>['data'][number]
let catalogBundle: Promise<CatalogBundle> | undefined

function modelCapabilities(value: z.infer<typeof capabilitiesSchema> | undefined): LiterModelCapabilities {
  return {
    vision: value?.vision ?? false,
    reasoning: value?.reasoning ?? false,
    structuredOutput: value?.structured_output ?? false,
    functionCalling: value?.function_calling ?? false,
    audioInput: value?.audio_input ?? value?.audio_in ?? false,
    audioOutput: value?.audio_output ?? value?.audio_out ?? false
  }
}

function catalogDirectory(): string {
  return path.join(application.getPath('feature.prometheus.pack.runtime'), 'catalogs', 'liter-llm')
}

async function checkedJson(filename: string, expectedSha256: string): Promise<unknown> {
  const contents = await fs.readFile(path.join(catalogDirectory(), filename))
  const actual = createHash('sha256').update(contents).digest('hex')
  if (actual !== expectedSha256) throw new Error('prometheus.error.literCatalogChecksum')
  return JSON.parse(contents.toString('utf8'))
}

async function loadLiterCatalogBundle(): Promise<CatalogBundle> {
  const metadata = catalogManifestSchema.parse(
    JSON.parse(await fs.readFile(path.join(catalogDirectory(), 'catalog-manifest.json'), 'utf8'))
  )
  const providerDocument = providersSchema.parse(await checkedJson('providers.json', metadata.providersSha256))
  const catalogDocument = catalogSchema.parse(await checkedJson('catalog.json', metadata.catalogSha256))
  const providerIds = new Set(providerDocument.providers.map((provider) => provider.name))
  const modelKeys = new Set<string>()
  const providers = providerDocument.providers.map((provider): LiterCatalogProvider => {
    const catalogProvider = catalogDocument.providers[provider.name]
    const models = Object.values(catalogProvider?.models ?? {})
      .map(
        (model): LiterCatalogModel => ({
          identity: { providerId: provider.name, modelId: model.id },
          name: model.name,
          ...(model.mode ? { mode: model.mode } : {}),
          ...(model.limit?.context ? { contextWindow: model.limit.context } : {}),
          ...(model.limit?.output ? { maxOutputTokens: model.limit.output } : {}),
          capabilities: modelCapabilities(model.capabilities)
        })
      )
      .sort((left, right) => left.name.localeCompare(right.name))
    for (const model of models) modelKeys.add(JSON.stringify([model.identity.providerId, model.identity.modelId]))
    return {
      identity: { providerId: provider.name },
      name: provider.display_name,
      ...(provider.base_url ? { baseUrl: provider.base_url } : {}),
      ...(provider.auth
        ? { auth: { type: provider.auth.type, ...(provider.auth.env_var ? { environmentVariable: provider.auth.env_var } : {}) } }
        : {}),
      endpoints: provider.endpoints,
      capabilities: modelCapabilities(provider.capabilities),
      models
    }
  })
  return { metadata, providers, providerIds, modelKeys }
}

function readLiterCatalogBundle(): Promise<CatalogBundle> {
  catalogBundle ??= loadLiterCatalogBundle()
  return catalogBundle
}

export async function fetchLiterLiveModels(config: IntegrationConfig, signal?: AbortSignal): Promise<LiterLiveModel[]> {
  const secrets = await readSecrets()
  const response = await fetch(`${config.services.liter.endpoint.replace(/\/$/, '')}/v1/models`, {
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
    headers: secrets.literKey ? { Authorization: `Bearer ${secrets.literKey}` } : undefined
  })
  if (!response.ok) throw new Error(`prometheus.error.gatewayModels:${response.status}`)
  return liveModelsSchema.parse(await response.json()).data
}

function selectedGatewayId(config: IntegrationConfig): string {
  const endpoint = new URL(config.services.liter.endpoint).href
  return `gateway-${createHash('sha256').update(endpoint).digest('hex').slice(0, 16)}`
}

export async function reconcileLiterCatalog(
  config: IntegrationConfig,
  revision: number,
  discovery: ServiceDiscovery,
  liveModels: LiterLiveModel[],
  liveError?: string
): Promise<LiterGatewayCatalogSnapshot> {
  const bundle = await readLiterCatalogBundle()
  const selectedConnectionId = selectedGatewayId(config)
  const selectedEndpoint = new URL(config.services.liter.endpoint).href
  const selectedCandidate = discovery.candidates.find(
    (candidate) =>
      candidate.service === 'liter' &&
      candidate.endpoint === selectedEndpoint &&
      candidate.provenance.some(
        (entry) =>
          entry.source === config.services.liter.source && entry.ownership === config.services.liter.ownership
      )
  )
  const credentialPresence = await readLiterConnectionCredentialPresence()
  const connections = config.services.literConnections.map((connection) => ({
    ...connection,
    identity: { providerConnectionId: connection.providerConnectionId },
    credentialConfigured: credentialPresence.has(connection.providerConnectionId),
    knownProvider: bundle.providerIds.has(connection.providerId)
  }))
  const configuredAliases = new Map<string, LiterServedAlias>(
    config.services.literAliases.map(
      (alias): [string, LiterServedAlias] => [
        JSON.stringify([alias.gatewayConnectionId, alias.alias]),
        {
          identity: { gatewayConnectionId: alias.gatewayConnectionId, alias: alias.alias },
          target: alias.target,
          displayName: alias.displayName ?? alias.alias,
          enabled: alias.enabled,
          available: false,
          custom:
            alias.custom || !bundle.modelKeys.has(JSON.stringify([alias.target.providerId, alias.target.modelId])),
          reconciliation: 'resolved',
          source: 'configured'
        }
      ]
    )
  )
  for (const live of liveModels) {
    const key = JSON.stringify([selectedConnectionId, live.id])
    const configured = configuredAliases.get(key)
    if (configured) {
      configured.available = true
      configured.source = 'configured-and-live'
      continue
    }
    const providerId = live.owned_by && bundle.providerIds.has(live.owned_by) ? live.owned_by : 'custom'
    configuredAliases.set(key, {
      identity: { gatewayConnectionId: selectedConnectionId, alias: live.id },
      displayName: live.id,
      enabled: true,
      available: true,
      custom: !bundle.modelKeys.has(JSON.stringify([providerId, live.id])),
      reconciliation: 'unresolved',
      source: 'live'
    })
  }
  return {
    schemaVersion: 1,
    revision,
    gateway: {
      identity: { gatewayConnectionId: selectedConnectionId },
      ...(selectedCandidate ? { selectedCandidateId: selectedCandidate.id } : {}),
      endpoint: config.services.liter.endpoint,
      ownership: config.services.liter.ownership,
      operational: !liveError,
      ...(liveError ? { error: liveError } : {}),
      candidates: literGatewayCandidates(discovery).flatMap((candidate) =>
        candidate.provenance.map((provenance) => ({
          id: candidate.id,
          endpoint: candidate.endpoint,
          source: provenance.source,
          ownership: provenance.ownership,
          label: provenance.label,
          selected:
            candidate.endpoint === selectedEndpoint &&
            provenance.source === config.services.liter.source &&
            provenance.ownership === config.services.liter.ownership
        }))
      )
    },
    catalog: {
      repository: bundle.metadata.repository,
      revision: bundle.metadata.revision,
      providersSha256: bundle.metadata.providersSha256,
      catalogSha256: bundle.metadata.catalogSha256
    },
    providers: bundle.providers,
    connections,
    aliases: [...configuredAliases.values()].sort((left, right) => left.displayName.localeCompare(right.displayName))
  }
}

export function literGatewayCandidates(discovery: ServiceDiscovery): ServiceCandidate[] {
  return discovery.candidates.filter((candidate) => candidate.service === 'liter')
}
