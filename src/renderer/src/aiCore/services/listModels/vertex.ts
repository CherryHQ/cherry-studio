import { loggerService } from '@logger'
import i18n from '@renderer/i18n'
import store from '@renderer/store'
import type { Provider } from '@renderer/types'
import { withoutTrailingSlash } from '@renderer/utils'
import {
  getMissingVertexAIConfigFields,
  VERTEX_AI_CONFIG_FIELD_LABEL_KEYS,
  type VertexAIConfigField
} from '@renderer/utils/vertexAI'
import { defaultAppHeaders } from '@shared/utils'

const logger = loggerService.withContext('ModelListService')

export const DEFAULT_VERTEX_MODEL_PUBLISHERS = [
  'google',
  'openai',
  'meta',
  'qwen',
  'deepseek-ai',
  'moonshotai',
  'zai-org'
] as const

export type VertexModelListRequest = {
  baseUrl: string
  headers: Record<string, string>
}

function getVertexServiceEndpoint(provider: Provider): string {
  const vertexSettings = store.getState().llm.settings.vertexai
  const apiHost = withoutTrailingSlash(provider.apiHost)
  const defaultHost =
    vertexSettings.location === 'global'
      ? 'https://aiplatform.googleapis.com'
      : `https://${vertexSettings.location}-aiplatform.googleapis.com`

  if (!apiHost || apiHost.endsWith('aiplatform.googleapis.com')) {
    return defaultHost
  }

  const vertexResourcePath = /\/v1(?:beta1)?\/projects\/[^/]+\/locations\/[^/]+$/
  if (vertexResourcePath.test(apiHost)) {
    return apiHost.replace(vertexResourcePath, '')
  }

  return apiHost.replace(/\/v1(?:beta1)?$/, '')
}

const EXCLUDED_VERTEX_PUBLISHER_MODEL_KEYWORDS = ['tts', 'audio'] as const

const SUPPORTED_VERTEX_PUBLISHER_MODEL_PATTERNS = [
  /^gemini[\w.@-]*$/i,
  /^learnlm[\w.@-]*$/i,
  /^gemma[\w.@-]*$/i,
  /^(?:text(?:-multilingual)?-embedding|gemini-embedding|multimodalembedding|textembedding-gecko(?:-multilingual)?|embedding-gecko(?:-multilingual)?)[\w.@-]*$/i,
  /^deepseek[\w.@-]*$/i,
  /^kimi[\w.@-]*$/i,
  /^glm[\w.@-]*$/i,
  /^gpt[\w.@-]*$/i,
  /^llama[\w.@-]*$/i,
  /^qwen[\w.@-]*$/i
] as const

function buildVertexAIIncompleteConfigMessage(missingFields: VertexAIConfigField[]): string {
  const missingFieldLabels = missingFields.map((field) => i18n.t(VERTEX_AI_CONFIG_FIELD_LABEL_KEYS[field])).join(', ')
  const locationHint = missingFields.includes('location')
    ? ` ${i18n.t('settings.provider.vertex_ai.location_help')}`
    : ''

  return `${i18n.t('settings.provider.vertex_ai.service_account.incomplete_config')}: ${missingFieldLabels}.${locationHint}`
}

export async function createVertexModelListRequest(provider: Provider): Promise<VertexModelListRequest | undefined> {
  const {
    location,
    projectId,
    serviceAccount: { privateKey, clientEmail }
  } = store.getState().llm.settings.vertexai

  const missingFields = getMissingVertexAIConfigFields({
    projectId,
    location,
    serviceAccount: {
      privateKey,
      clientEmail
    }
  })

  if (missingFields.length > 0) {
    const errorMessage = buildVertexAIIncompleteConfigMessage(missingFields)

    window.toast?.error(errorMessage)
    logger.warn('Vertex AI model listing skipped because service account settings are incomplete', {
      providerId: provider.id,
      missingFields
    })
    return undefined
  }

  let authHeaders: Record<string, string>

  try {
    authHeaders = await window.api.vertexAI.getAuthHeaders({
      projectId,
      serviceAccount: {
        privateKey,
        clientEmail
      }
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)

    window.toast?.error(errorMessage)
    logger.warn('Vertex AI model listing skipped because authentication failed', {
      providerId: provider.id,
      error: errorMessage
    })
    return undefined
  }

  return {
    baseUrl: getVertexServiceEndpoint(provider),
    headers: {
      ...defaultAppHeaders(),
      ...authHeaders,
      ...provider.extra_headers
    }
  }
}

export function getVertexModelId(name: string): string {
  const marker = '/models/'
  const markerIndex = name.lastIndexOf(marker)

  if (markerIndex >= 0) {
    return name.slice(markerIndex + marker.length)
  }

  return name.split('/').pop() || name
}

export function getVertexModelPublisher(name: string): string {
  const marker = 'publishers/'
  const markerIndex = name.indexOf(marker)

  if (markerIndex < 0) {
    return 'google'
  }

  const publisher = name.slice(markerIndex + marker.length).split('/')[0]
  return publisher || 'google'
}

export function isSupportedVertexPublisherModel(modelId: string): boolean {
  const normalizedModelId = modelId.trim().toLowerCase()

  if (EXCLUDED_VERTEX_PUBLISHER_MODEL_KEYWORDS.some((keyword) => normalizedModelId.includes(keyword))) {
    return false
  }

  return SUPPORTED_VERTEX_PUBLISHER_MODEL_PATTERNS.some((pattern) => pattern.test(normalizedModelId))
}
