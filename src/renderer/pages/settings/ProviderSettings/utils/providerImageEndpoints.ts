import { validateApiHost } from '@renderer/utils/api'
import { ENDPOINT_TYPE, type EndpointType } from '@shared/data/types/model'
import type { EndpointConfig } from '@shared/data/types/provider'
import { isEmpty, trim } from 'es-toolkit/compat'

export interface ProviderImageEndpointDraft {
  imagesBaseUrl: string
  useSeparateImageEditUrl: boolean
  imageEditBaseUrl: string
}

export type ProviderImageEndpointDraftField = 'imagesBaseUrl' | 'imageEditBaseUrl'

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
  const imagesBaseUrl = trim(endpointConfigs?.[ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION]?.baseUrl ?? '')
  const imageEditBaseUrl = trim(endpointConfigs?.[ENDPOINT_TYPE.OPENAI_IMAGE_EDIT]?.baseUrl ?? '')

  return {
    imagesBaseUrl,
    useSeparateImageEditUrl: imagesBaseUrl !== imageEditBaseUrl,
    imageEditBaseUrl
  }
}

export function mergeProviderImageEndpointDraft(
  existing: Partial<Record<EndpointType, EndpointConfig>> | undefined,
  draft: ProviderImageEndpointDraft
): Partial<Record<EndpointType, EndpointConfig>> {
  const endpointConfigs: Partial<Record<EndpointType, EndpointConfig>> = { ...existing }
  const imagesBaseUrl = trim(draft.imagesBaseUrl)
  const imageEditBaseUrl = draft.useSeparateImageEditUrl ? trim(draft.imageEditBaseUrl) : imagesBaseUrl

  setEndpointBaseUrl(endpointConfigs, ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION, imagesBaseUrl)
  setEndpointBaseUrl(endpointConfigs, ENDPOINT_TYPE.OPENAI_IMAGE_EDIT, imageEditBaseUrl)

  return endpointConfigs
}

export function findInvalidProviderImageEndpointDraft(
  draft: ProviderImageEndpointDraft
): ProviderImageEndpointDraftField | null {
  const imagesBaseUrl = trim(draft.imagesBaseUrl)
  if (imagesBaseUrl && !validateApiHost(imagesBaseUrl)) {
    return 'imagesBaseUrl'
  }

  const imageEditBaseUrl = trim(draft.imageEditBaseUrl)
  if (draft.useSeparateImageEditUrl && imageEditBaseUrl && !validateApiHost(imageEditBaseUrl)) {
    return 'imageEditBaseUrl'
  }

  return null
}
