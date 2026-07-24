import { validateApiHost } from '@renderer/utils/api'
import { ENDPOINT_TYPE, type EndpointType } from '@shared/data/types/model'
import type { EndpointConfig } from '@shared/data/types/provider'
import { isEmpty, trim } from 'es-toolkit/compat'

export interface ProviderImageEndpointDraft {
  imageGenerationBaseUrl: string
  imageEditBaseUrl: string
}

export type ProviderImageEndpointDraftField = 'imageGenerationBaseUrl' | 'imageEditBaseUrl'

function setEndpointBaseUrl(
  endpointConfigs: Partial<Record<EndpointType, EndpointConfig>>,
  type: EndpointType,
  baseUrl: string
) {
  const value = trim(baseUrl)
  if (value) {
    endpointConfigs[type] = { ...endpointConfigs[type], baseUrl: value }
    return
  }

  const remainingConfig = { ...endpointConfigs[type] }
  delete remainingConfig.baseUrl
  if (isEmpty(remainingConfig)) {
    delete endpointConfigs[type]
  } else {
    endpointConfigs[type] = remainingConfig
  }
}

export function readProviderImageEndpointDraft(
  endpointConfigs: Partial<Record<EndpointType, EndpointConfig>> | undefined
): ProviderImageEndpointDraft {
  const imageGenerationBaseUrl = trim(endpointConfigs?.[ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION]?.baseUrl ?? '')
  const imageEditBaseUrl = trim(endpointConfigs?.[ENDPOINT_TYPE.OPENAI_IMAGE_EDIT]?.baseUrl ?? '')

  return {
    imageGenerationBaseUrl,
    imageEditBaseUrl
  }
}

export function mergeProviderImageEndpointDraft(
  existing: Partial<Record<EndpointType, EndpointConfig>> | undefined,
  draft: ProviderImageEndpointDraft
): Partial<Record<EndpointType, EndpointConfig>> {
  const endpointConfigs: Partial<Record<EndpointType, EndpointConfig>> = { ...existing }

  setEndpointBaseUrl(endpointConfigs, ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION, trim(draft.imageGenerationBaseUrl))
  setEndpointBaseUrl(endpointConfigs, ENDPOINT_TYPE.OPENAI_IMAGE_EDIT, trim(draft.imageEditBaseUrl))

  return endpointConfigs
}

export function findInvalidProviderImageEndpointDraft(
  draft: ProviderImageEndpointDraft
): ProviderImageEndpointDraftField | null {
  const imageGenerationBaseUrl = trim(draft.imageGenerationBaseUrl)
  if (imageGenerationBaseUrl && !validateApiHost(imageGenerationBaseUrl)) {
    return 'imageGenerationBaseUrl'
  }

  const imageEditBaseUrl = trim(draft.imageEditBaseUrl)
  if (imageEditBaseUrl && !validateApiHost(imageEditBaseUrl)) {
    return 'imageEditBaseUrl'
  }

  return null
}
