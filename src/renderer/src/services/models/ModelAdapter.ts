import type { GatewayLanguageModelEntry } from '@ai-sdk/gateway'
import { loggerService } from '@logger'
import { type EndpointType, EndPointTypeSchema, type Model, type Provider } from '@renderer/types'
import type { NewApiModel, SdkModel } from '@renderer/types/sdk'
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

export function normalizeSdkModels(provider: Provider, models: SdkModel[]): Model[] {
  return normalizeModels(models, (entry) => adaptSdkModel(provider, entry))
}

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

function adaptSdkModel(provider: Provider, model: SdkModel): Model | null {
  const id = pickPreferredString([(model as any)?.id, (model as any)?.modelId])
  const name = pickPreferredString([
    (model as any)?.display_name,
    (model as any)?.displayName,
    (model as any)?.name,
    id
  ])

  if (!id || !name) {
    logger.warn('Skip SDK model with missing id or name', {
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
    description: pickPreferredString([(model as any)?.description, (model as any)?.summary]),
    owned_by: pickPreferredString([(model as any)?.owned_by, (model as any)?.publisher])
  }

  const supportedEndpointTypes = pickSupportedEndpointTypes(provider.id, model)
  if (supportedEndpointTypes) {
    candidate.supported_endpoint_types = supportedEndpointTypes
  }

  return validateModel(candidate, model)
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

function pickPreferredString(values: Array<unknown>): string | undefined {
  for (const value of values) {
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed.length > 0) {
        return trimmed
      }
    }
  }
  return undefined
}

function pickSupportedEndpointTypes(providerId: string, model: SdkModel): EndpointType[] | undefined {
  const candidate =
    (model as Partial<NewApiModel>).supported_endpoint_types ??
    ((model as Record<string, unknown>).supported_endpoint_types as EndpointType[] | undefined)

  if (!Array.isArray(candidate) || candidate.length === 0) {
    return undefined
  }

  const supported: EndpointType[] = []
  const unsupported: unknown[] = []

  for (const value of candidate) {
    const parsed = EndPointTypeSchema.safeParse(value)
    if (parsed.success) {
      supported.push(parsed.data)
    } else {
      unsupported.push(value)
    }
  }

  if (unsupported.length > 0) {
    logger.warn('Pruned unsupported endpoint types', {
      providerId,
      values: unsupported,
      modelSnippet: summarizeModel(model)
    })
  }

  return supported.length > 0 ? supported : undefined
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
