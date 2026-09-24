import * as z from 'zod'

import { application } from '@application'
import { modelService } from '@data/services/ModelService'
import { providerService } from '@data/services/ProviderService'
import { readIntegrationConfig, readSecrets } from '@main/services/prometheus/integrationConfig'
import type { UarModelSourceSnapshot, UarProviderMutation } from '@shared/types/prometheusIntegration'
import { getRawModelId } from '@shared/utils/model'

const providerResponseSchema = z.object({
  default_id: z.string().nullable().optional(),
  providers: z.array(
    z.object({
      id: z.string(),
      display_name: z.string(),
      base_url: z.string(),
      protocol: z.enum(['auto', 'chat', 'responses']),
      default_model: z.string().nullable().optional(),
      models: z.array(
        z.object({
          id: z.string(),
          display_name: z.string().nullable().optional(),
          context_window: z.number().nullable().optional(),
          supports_vision: z.boolean(),
          supports_tools: z.boolean(),
          supports_reasoning: z.boolean(),
          supports_structured_output: z.boolean(),
          supports_streaming: z.boolean(),
          max_output_tokens: z.number().nullable().optional(),
          enabled: z.boolean()
        })
      ),
      enabled: z.boolean(),
      credential_configured: z.boolean()
    })
  )
})
const gatewayResponseSchema = z.object({ data: z.array(z.object({ id: z.string().min(1) })).default([]) })

function gatewayModelsEndpoint(endpoint: string): string {
  const url = new URL(endpoint)
  const pathname = url.pathname.replace(/\/$/, '')
  url.pathname = `${pathname.endsWith('/v1') ? pathname : `${pathname}/v1`}/models`
  return url.href
}

async function responseBody(response: Response): Promise<unknown> {
  const body: unknown = await response.json().catch(() => undefined)
  if (response.ok) return body
  const detail =
    typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
      ? body.error
      : `HTTP ${response.status}`
  throw new Error(detail)
}

/** Main-process-only model source projection. Secret values are reduced to
 * presence flags before the result crosses IPC. */
export async function readUarModelSources(): Promise<UarModelSourceSnapshot> {
  const sidecar = application.get('UarSidecarService')
  const endpoint = await sidecar.ensureReady()
  const uarResponse = await sidecar.adminRequest('/api/uar/providers', {}, endpoint.generation)
  const uar = providerResponseSchema.parse(await responseBody(uarResponse))
  const config = readIntegrationConfig()
  const secrets = await readSecrets()
  const bossProviders = providerService.list({})
  const bossModels = modelService.list({})

  let gatewayModels: string[] = []
  let gatewayError: string | undefined
  try {
    const response = await fetch(gatewayModelsEndpoint(config.services.liter.endpoint), {
      headers: { authorization: `Bearer ${secrets.literKey ?? ''}` },
      signal: AbortSignal.timeout(10_000)
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    gatewayModels = gatewayResponseSchema.parse(await response.json()).data.map((model) => model.id)
  } catch (error) {
    gatewayError = error instanceof Error ? error.message : String(error)
  }

  return {
    schemaVersion: 1,
    generation: endpoint.generation,
    sources: [
      {
        source: 'boss',
        instanceId: 'the-boss',
        instanceName: 'The Boss',
        connectedInstance: 'Application model catalog',
        operational: true,
        providers: bossProviders.map((provider) => ({
          id: provider.id,
          name: provider.name ?? provider.id,
          credentialConfigured: provider.apiKeys.length > 0 || Boolean(provider.authOptional),
          enabled: provider.isEnabled,
          models: bossModels
            .filter((model) => model.providerId === provider.id)
            .map((model) => ({
              id: model.id,
              name: model.name ?? model.id,
              enabled: model.isEnabled,
              effectiveIdentity: `${provider.id}/${getRawModelId(model)}`
            }))
        }))
      },
      {
        source: 'gateway',
        instanceId: `liter:${config.services.liter.endpoint}`,
        instanceName: config.services.liter.source === 'full-pack' ? 'Prometheus full-pack liter-llm' : 'liter-llm',
        connectedInstance: config.services.liter.endpoint,
        operational: gatewayError === undefined,
        ...(gatewayError ? { error: gatewayError } : {}),
        providers: [
          {
            id: 'the-boss-gateway',
            name: 'liter-llm',
            credentialConfigured: Boolean(secrets.literKey),
            enabled: true,
            models: gatewayModels.map((model) => ({
              id: model,
              name: model,
              enabled: true,
              effectiveIdentity: `the-boss-gateway/${model}`
            }))
          }
        ]
      },
      {
        source: 'uar',
        instanceId: `uar:${endpoint.generation}`,
        instanceName: 'Universal Agent Runtime',
        connectedInstance: endpoint.baseUrl,
        operational: true,
        providers: uar.providers.map((provider) => ({
          id: provider.id,
          name: provider.display_name || provider.id,
          credentialConfigured: provider.credential_configured,
          enabled: provider.enabled,
          baseUrl: provider.base_url,
          protocol: provider.protocol,
          ...(provider.default_model ? { defaultModel: provider.default_model } : {}),
          isDefault: uar.default_id === provider.id,
          models: provider.models.map((model) => ({
            id: model.id,
            name: model.display_name || model.id,
            enabled: model.enabled,
            effectiveIdentity: `${provider.id}/${model.id}`,
            ...(model.context_window ? { contextWindow: model.context_window } : {}),
            supportsVision: model.supports_vision,
            supportsTools: model.supports_tools,
            supportsReasoning: model.supports_reasoning,
            supportsStructuredOutput: model.supports_structured_output,
            supportsStreaming: model.supports_streaming,
            ...(model.max_output_tokens ? { maxOutputTokens: model.max_output_tokens } : {})
          }))
        }))
      }
    ],
    consumers: [
      {
        id: 'agent-inference',
        state: 'configurable',
        sources: ['boss', 'gateway', 'uar'],
        detail: 'The selected catalog policy controls each admitted run.'
      },
      {
        id: 'knowledge-embeddings',
        state: 'local',
        effectiveIdentity: 'fastembed/BAAI-bge-small-en-v1.5',
        sources: [],
        detail: 'The active knowledge service accepts its local FastEmbed provider only.'
      },
      {
        id: 'vision',
        state: 'unavailable',
        sources: [],
        detail: 'This sidecar build has no separate vision model consumer.'
      },
      {
        id: 'intent-classifier',
        state: 'local',
        effectiveIdentity: 'local/skill-intent-classifier',
        sources: [],
        detail: 'Intent classification uses the local skill index.'
      },
      {
        id: 'mistral-ocr',
        state: 'disabled',
        sources: [],
        detail: 'Mistral OCR is inactive while the sidecar uses Kreuzberg file processing.'
      },
      {
        id: 'memory',
        state: 'disabled',
        sources: [],
        detail: 'In-process UAR memory is disabled because The Boss supplies Surreal Memory over MCP.'
      }
    ]
  }
}

function providerPayload(input: UarProviderMutation): Record<string, unknown> {
  return {
    id: input.id,
    display_name: input.displayName,
    base_url: input.baseUrl,
    protocol: input.protocol,
    default_model: input.defaultModel,
    models: input.models.map((model) => ({
      id: model.id,
      display_name: model.displayName,
      context_window: model.contextWindow,
      supports_vision: model.supportsVision,
      supports_tools: model.supportsTools,
      supports_reasoning: model.supportsReasoning,
      supports_structured_output: model.supportsStructuredOutput,
      supports_streaming: model.supportsStreaming,
      max_output_tokens: model.maxOutputTokens,
      enabled: model.enabled
    })),
    enabled: input.enabled,
    ...(input.credential.operation === 'set' ? { api_key: input.credential.value } : {}),
    ...(input.credential.operation === 'clear' ? { api_key: '' } : {})
  }
}

export async function saveUarProvider(input: UarProviderMutation): Promise<UarModelSourceSnapshot> {
  const sidecar = application.get('UarSidecarService')
  const endpoint = await sidecar.ensureReady()
  const pathname = input.mode === 'create' ? '/api/uar/providers' : `/api/uar/providers/${encodeURIComponent(input.id)}`
  const response = await sidecar.adminRequest(
    pathname,
    {
      method: input.mode === 'create' ? 'POST' : 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(providerPayload(input))
    },
    endpoint.generation
  )
  await responseBody(response)
  return readUarModelSources()
}

export async function deleteUarProvider(id: string): Promise<UarModelSourceSnapshot> {
  const sidecar = application.get('UarSidecarService')
  const endpoint = await sidecar.ensureReady()
  const response = await sidecar.adminRequest(
    `/api/uar/providers/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
    endpoint.generation
  )
  if (!response.ok) await responseBody(response)
  return readUarModelSources()
}

export async function setDefaultUarProvider(id: string): Promise<UarModelSourceSnapshot> {
  const sidecar = application.get('UarSidecarService')
  const endpoint = await sidecar.ensureReady()
  const response = await sidecar.adminRequest(
    `/api/uar/providers/${encodeURIComponent(id)}/default`,
    { method: 'POST' },
    endpoint.generation
  )
  if (!response.ok) await responseBody(response)
  return readUarModelSources()
}

export async function testUarProvider(
  id: string,
  modelId: string
): Promise<{ ok: boolean; providerId: string; modelId: string; latencyMs: number }> {
  const sidecar = application.get('UarSidecarService')
  const endpoint = await sidecar.ensureReady()
  const response = await sidecar.adminRequest(
    `/api/uar/providers/${encodeURIComponent(id)}/test`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: modelId })
    },
    endpoint.generation
  )
  const body = z
    .object({
      ok: z.boolean(),
      provider_id: z.string(),
      model_id: z.string(),
      latency_ms: z.number()
    })
    .parse(await responseBody(response))
  return { ok: body.ok, providerId: body.provider_id, modelId: body.model_id, latencyMs: body.latency_ms }
}
