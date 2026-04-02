import type { GatewayLanguageModelEntry } from '@ai-sdk/gateway'
import { loggerService } from '@logger'
import { EndPointTypeSchema, type Model, type Provider } from '@renderer/types'
import { getDefaultGroupName } from '@renderer/utils/naming'
import * as z from 'zod'

const logger = loggerService.withContext('ModelAdapter')

const EndpointTypeArraySchema = z.array(EndPointTypeSchema).nonempty()

const NormalizedModelSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  provider: z.string().trim().min(1),
  group: z.string().trim().min(1),
  description: z.string().optional(),
  owned_by: z.string().optional(),
  supported_endpoint_types: EndpointTypeArraySchema.optional()
})

type NormalizedModelInput = z.input<typeof NormalizedModelSchema>

export function normalizeGatewayModels(provider: Provider, models: GatewayLanguageModelEntry[]): Model[] {
  return normalizeModels(models, (entry) => adaptGatewayModel(provider, entry))
}

function normalizeModels<T>(models: T[], transformer: (entry: T) => Model | null): Model[] {
  const uniqueModels: Model[] = []
  const seen = new Set<string>()

  for (const entry of models) {
    const normalized = transformer(entry)
    if (!normalized) continue
    if (seen.has(normalized.id)) continue
    seen.add(normalized.id)
    uniqueModels.push(normalized)
  }

  return uniqueModels
}

function adaptGatewayModel(provider: Provider, model: GatewayLanguageModelEntry): Model | null {
  const id = model?.id?.trim()
  const name = model?.name?.trim() || id

  if (!id || !name) {
    logger.warn('Skip gateway model with missing id or name', {
      providerId: provider.id,
      modelSnippet: summarizeModel(model)
    })
    return null
  }

  const candidate: NormalizedModelInput = {
    id,
    name,
    provider: provider.id,
    group: getDefaultGroupName(id, provider.id),
    description: model.description ?? undefined
  }

  return validateModel(candidate, model)
}

function validateModel(candidate: NormalizedModelInput, source: unknown): Model | null {
  const parsed = NormalizedModelSchema.safeParse(candidate)
  if (!parsed.success) {
    logger.warn('Discard invalid model entry', {
      providerId: candidate.provider,
      issues: parsed.error.issues,
      modelSnippet: summarizeModel(source)
    })
    return null
  }

  return parsed.data
}

function summarizeModel(model: unknown) {
  if (!model || typeof model !== 'object') {
    return model
  }
  const { id, name, display_name, displayName, description, owned_by, supported_endpoint_types } = model as Record<
    string,
    unknown
  >

  return {
    id,
    name,
    display_name,
    displayName,
    description,
    owned_by,
    supported_endpoint_types
  }
}
