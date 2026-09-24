import * as z from 'zod'

import { application } from '@application'
import { modelService } from '@data/services/ModelService'
import { providerService } from '@data/services/ProviderService'
import { readIntegrationConfig, readSecrets } from '@main/services/prometheus/integrationConfig'
import type { UarModelSourceSnapshot } from '@shared/types/prometheusIntegration'
import { getRawModelId } from '@shared/utils/model'

const providerResponseSchema = z.object({
  providers: z.array(
    z.object({
      id: z.string(),
      display_name: z.string(),
      models: z.array(
        z.object({ id: z.string(), display_name: z.string().nullable().optional(), enabled: z.boolean() })
      ),
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
  const uarResponse = await sidecar.adminRequest('/api/uar/providers/enabled', {}, endpoint.generation)
  const uar = providerResponseSchema.parse(await responseBody(uarResponse))
  const config = readIntegrationConfig()
  const secrets = await readSecrets()
  const bossProviders = providerService.list({ enabled: true })
  const bossModels = modelService.list({ enabled: true })

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
          models: provider.models.map((model) => ({
            id: model.id,
            name: model.display_name || model.id,
            enabled: model.enabled,
            effectiveIdentity: `${provider.id}/${model.id}`
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
