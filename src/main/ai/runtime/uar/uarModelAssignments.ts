import { modelService } from '@data/services/ModelService'
import { providerService } from '@data/services/ProviderService'
import { resolveEffectiveEndpoint } from '@main/ai/provider/endpoint'
import { createAiUsagePricingSnapshot } from '@main/ai/utils/usageCapture'
import { readIntegrationConfig, readSecrets } from '@main/services/prometheus/integrationConfig'
import type { UarModelAssignment } from '@shared/data/api/schemas/agents'
import { ENDPOINT_TYPE, parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import { getRawModelId } from '@shared/utils/model'

import type { AgentSessionUsageCapture } from '../types'

export type UarRunCredential = {
  provider_id: string
  provider_kind: 'openai_compatible' | 'anthropic'
  base_url: string
  api_key: string
}

export type ResolvedUarModelAssignment = {
  source: 'boss' | 'gateway' | 'uar'
  providerId: string
  modelId: string
  providerName: string
  modelName: string
  effectiveIdentity: string
  connectedInstance: string
  credential?: UarRunCredential
  usageCapture?: AgentSessionUsageCapture
}

function normalizeGatewayEndpoint(endpoint: string): string {
  const url = new URL(endpoint)
  const pathname = url.pathname.replace(/\/$/, '')
  url.pathname = pathname.endsWith('/v1') ? pathname : `${pathname}/v1`
  return url.href.replace(/\/$/, '')
}

function resolveBossModel(uniqueModelId: UniqueModelId): ResolvedUarModelAssignment {
  const { providerId, modelId } = parseUniqueModelId(uniqueModelId)
  const provider = providerService.getByProviderId(providerId)
  const model = modelService.getByKey(providerId, modelId)
  const endpoint = resolveEffectiveEndpoint(provider, model)
  const providerKind =
    endpoint.endpointType === ENDPOINT_TYPE.ANTHROPIC_MESSAGES
      ? 'anthropic'
      : endpoint.endpointType === ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS ||
          endpoint.endpointType === ENDPOINT_TYPE.OPENAI_RESPONSES ||
          endpoint.endpointType === ENDPOINT_TYPE.OLLAMA_CHAT
        ? 'openai_compatible'
        : undefined
  if (!providerKind || !endpoint.baseUrl) {
    throw new Error(`Provider "${provider.name}" is not compatible with Universal Agent Runtime`)
  }
  const resolved = providerService.resolveApiKey(provider.id)
  const apiKey = resolved.value.trim() || (provider.authOptional ? 'no-key-required' : '')
  if (!apiKey) throw new Error(`Provider "${provider.name}" has no API key configured`)
  const apiModelId = getRawModelId(model)
  return {
    source: 'boss',
    providerId: provider.id,
    modelId: apiModelId,
    providerName: provider.name ?? provider.id,
    modelName: model.name ?? model.id,
    effectiveIdentity: `${provider.id}/${apiModelId}`,
    connectedInstance: endpoint.baseUrl,
    credential: {
      provider_id: provider.id,
      provider_kind: providerKind,
      base_url: endpoint.baseUrl,
      api_key: apiKey
    },
    usageCapture: {
      owner: 'agent-sdk',
      credentialReceipt: resolved.apiKeySelection,
      providerId: provider.id,
      providerName: provider.name ?? null,
      source: null,
      frozenModels: [
        {
          modelId: model.id,
          apiModelId,
          modelName: model.name ?? model.id,
          aliases: [...new Set([model.id, apiModelId])],
          pricingSnapshot: createAiUsagePricingSnapshot(model.pricing)
        }
      ]
    }
  }
}

export async function resolveUarModelAssignment(
  assignment: UarModelAssignment | undefined,
  activeBossModel: UniqueModelId
): Promise<ResolvedUarModelAssignment> {
  if (!assignment || assignment.source === 'boss') {
    return resolveBossModel(assignment?.modelId ?? activeBossModel)
  }
  if (assignment.source === 'uar') {
    return {
      source: 'uar',
      providerId: assignment.providerId,
      modelId: assignment.modelId,
      providerName: assignment.providerId,
      modelName: assignment.modelId,
      effectiveIdentity: `${assignment.providerId}/${assignment.modelId}`,
      connectedInstance: 'Universal Agent Runtime'
    }
  }
  const config = readIntegrationConfig()
  const secrets = await readSecrets()
  const apiKey = secrets.literKey?.trim()
  if (!apiKey) throw new Error('The selected liter-llm gateway has no credential configured')
  const endpoint = normalizeGatewayEndpoint(config.services.liter.endpoint)
  return {
    source: 'gateway',
    providerId: 'the-boss-gateway',
    modelId: assignment.modelId,
    providerName: 'liter-llm',
    modelName: assignment.modelId,
    effectiveIdentity: `the-boss-gateway/${assignment.modelId}`,
    connectedInstance: endpoint,
    credential: {
      provider_id: 'the-boss-gateway',
      provider_kind: 'openai_compatible',
      base_url: endpoint,
      api_key: apiKey
    }
  }
}
