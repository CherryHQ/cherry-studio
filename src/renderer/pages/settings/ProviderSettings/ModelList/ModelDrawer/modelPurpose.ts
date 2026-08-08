import {
  ENDPOINT_TYPE,
  type EndpointType,
  MODALITY,
  type Modality,
  MODEL_CAPABILITY,
  type ModelCapability
} from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { matchesPreset } from '@shared/utils/provider'
import { isSystemProviderId } from '@shared/utils/systemProviderId'

import type { ModelDrawerMode } from './types'

export type ModelPurpose = 'chat' | 'image-generation' | 'image-edit'

export const MODEL_CHAT_ENDPOINT_TYPES = [
  ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
  ENDPOINT_TYPE.OPENAI_RESPONSES,
  ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
  ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT
] as const

export type ModelChatEndpointType = (typeof MODEL_CHAT_ENDPOINT_TYPES)[number]

export interface ModelPurposeFields {
  endpointTypes?: readonly EndpointType[]
  capabilities?: readonly ModelCapability[]
  inputModalities?: readonly Modality[]
  outputModalities?: readonly Modality[]
}

export interface AppliedModelPurposeFields {
  endpointTypes: EndpointType[]
  capabilities: ModelCapability[]
  inputModalities?: Modality[]
  outputModalities?: Modality[]
}

export interface ApplyModelPurposeOptions {
  chatEndpointType?: ModelChatEndpointType
  previousPurpose?: ModelPurpose
}

type ModelDrawerProvider = Pick<Provider, 'id' | 'presetProviderId'>
export type ProviderChatEndpoints = Pick<Provider, 'defaultChatEndpoint' | 'endpointConfigs'>

function isModelChatEndpointType(endpointType: string | undefined): endpointType is ModelChatEndpointType {
  return MODEL_CHAT_ENDPOINT_TYPES.some((candidate) => candidate === endpointType)
}

function addUnique<T>(items: readonly T[] | undefined, item: T): T[] {
  const next = [...(items ?? [])]
  if (!next.includes(item)) {
    next.push(item)
  }
  return next
}

function removeItem<T>(items: readonly T[] | undefined, item: T): T[] | undefined {
  return items?.filter((candidate) => candidate !== item)
}

export function getModelDrawerMode(provider: ModelDrawerProvider): ModelDrawerMode {
  if (matchesPreset(provider, 'new-api') || matchesPreset(provider, 'cherryin') || matchesPreset(provider, 'aionly')) {
    return 'endpoint-types'
  }
  if (provider.presetProviderId == null && !isSystemProviderId(provider.id)) {
    return 'purpose'
  }
  return 'legacy'
}

export function getProviderChatEndpointTypes(provider: ProviderChatEndpoints): ModelChatEndpointType[] {
  const endpointTypes: ModelChatEndpointType[] = []

  if (isModelChatEndpointType(provider.defaultChatEndpoint)) {
    endpointTypes.push(provider.defaultChatEndpoint)
  }

  for (const endpointType of Object.keys(provider.endpointConfigs ?? {})) {
    if (isModelChatEndpointType(endpointType) && !endpointTypes.includes(endpointType)) {
      endpointTypes.push(endpointType)
    }
  }

  return endpointTypes
}

/**
 * The chat endpoints a model could be routed to. Two or more means the user has a real choice and the
 * preferred-endpoint picker is worth showing; one or none means there is nothing to pick.
 *
 * A model that declares its own endpoints narrows the provider's list to those (a model may support
 * fewer protocols than its host); aggregator models declare endpoints the provider config never lists,
 * so an empty intersection falls back to what the model declares.
 */
export function getPreferredEndpointCandidates(
  provider: ProviderChatEndpoints,
  modelEndpointTypes?: readonly EndpointType[]
): ModelChatEndpointType[] {
  if (!modelEndpointTypes?.length) {
    return getProviderChatEndpointTypes(provider)
  }

  // Declared but non-chat (embeddings, image, rerank) means this model is not routed over a chat
  // protocol at all, so there is nothing to choose.
  const declared = modelEndpointTypes.filter(isModelChatEndpointType)
  if (declared.length === 0) {
    return []
  }

  const providerEndpointTypes = getProviderChatEndpointTypes(provider)
  const narrowed = declared.filter((endpointType) => providerEndpointTypes.includes(endpointType))
  return narrowed.length > 0 ? narrowed : declared
}

export function inferModelPurpose(fields: ModelPurposeFields): ModelPurpose {
  const primaryEndpointType = fields.endpointTypes?.[0]

  if (primaryEndpointType === ENDPOINT_TYPE.OPENAI_IMAGE_EDIT) {
    return 'image-edit'
  }
  if (primaryEndpointType === ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION) {
    return 'image-generation'
  }
  if (!primaryEndpointType && fields.capabilities?.includes(MODEL_CAPABILITY.IMAGE_GENERATION)) {
    return 'image-generation'
  }
  return 'chat'
}

export function getInitialChatEndpointType(
  fields: ModelPurposeFields,
  fallback: ModelChatEndpointType = ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
): ModelChatEndpointType {
  return fields.endpointTypes?.find(isModelChatEndpointType) ?? fallback
}

export function applyModelPurpose(
  fields: ModelPurposeFields,
  purpose: ModelPurpose,
  options: ApplyModelPurposeOptions = {}
): AppliedModelPurposeFields {
  const previousPurpose = options.previousPurpose ?? inferModelPurpose(fields)
  let capabilities = [...(fields.capabilities ?? [])]
  let inputModalities = fields.inputModalities ? [...fields.inputModalities] : undefined
  let outputModalities = fields.outputModalities ? [...fields.outputModalities] : undefined

  if (previousPurpose !== 'chat') {
    capabilities = capabilities.filter((capability) => capability !== MODEL_CAPABILITY.IMAGE_GENERATION)
    outputModalities = removeItem(outputModalities, MODALITY.IMAGE)

    if (previousPurpose === 'image-edit' && !capabilities.includes(MODEL_CAPABILITY.IMAGE_RECOGNITION)) {
      inputModalities = removeItem(inputModalities, MODALITY.IMAGE)
    }
  }

  if (purpose === 'chat') {
    return {
      endpointTypes: [
        options.chatEndpointType ?? getInitialChatEndpointType(fields, ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS)
      ],
      capabilities,
      inputModalities,
      outputModalities
    }
  }

  capabilities = addUnique(capabilities, MODEL_CAPABILITY.IMAGE_GENERATION)
  outputModalities = addUnique(outputModalities, MODALITY.IMAGE)

  if (purpose === 'image-edit') {
    inputModalities = addUnique(inputModalities, MODALITY.IMAGE)
  }

  return {
    endpointTypes: [purpose === 'image-edit' ? ENDPOINT_TYPE.OPENAI_IMAGE_EDIT : ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION],
    capabilities,
    inputModalities,
    outputModalities
  }
}
