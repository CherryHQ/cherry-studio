import { providerService } from '@data/services/ProviderService'
import { loggerService } from '@logger'
import { vertexAiService } from '@main/services/VertexAiService'
import type { Provider } from '@shared/data/types/provider'
import { defaultAppHeaders } from '@shared/utils'
import { withoutTrailingSlash } from '@shared/utils/api/utils'

import { getBaseUrl } from '../../utils/provider'
import { normalizeVertexCredentials } from '../config'

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

function getVertexServiceEndpoint(provider: Provider, location: string): string {
  const apiHost = withoutTrailingSlash(getBaseUrl(provider))
  const defaultHost =
    location === 'global' ? 'https://aiplatform.googleapis.com' : `https://${location}-aiplatform.googleapis.com`

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

export async function createVertexModelListRequest(
  provider: Provider,
  options?: { throwOnError?: boolean }
): Promise<VertexModelListRequest | undefined> {
  const failOrSkip = (reason: string, context: Record<string, unknown>): undefined => {
    if (options?.throwOnError) {
      throw new Error(`Vertex AI model listing failed: ${reason}`)
    }
    logger.warn(`Vertex AI model listing skipped — ${reason}`, context)
    return undefined
  }

  const authConfig = await providerService.getAuthConfig(provider.id)
  if (authConfig?.type !== 'iam-gcp') {
    return failOrSkip('provider is not configured with iam-gcp auth', {
      providerId: provider.id,
      authType: authConfig?.type
    })
  }

  const { project, location, credentials } = authConfig
  const { privateKey, clientEmail } = normalizeVertexCredentials(credentials)

  const missing: string[] = []
  if (!project) missing.push('project')
  if (!location) missing.push('location')
  if (!privateKey) missing.push('privateKey')
  if (!clientEmail) missing.push('clientEmail')

  if (missing.length > 0) {
    return failOrSkip('missing required service-account fields', {
      providerId: provider.id,
      missing
    })
  }

  let authHeaders: Record<string, string>
  try {
    authHeaders = await vertexAiService.getAuthHeaders({
      projectId: project,
      serviceAccount: { privateKey: privateKey!, clientEmail: clientEmail! }
    })
  } catch (error) {
    if (options?.throwOnError) {
      throw error
    }
    logger.warn('Vertex AI model listing skipped — authentication failed', {
      providerId: provider.id,
      error: error instanceof Error ? error.message : String(error)
    })
    return undefined
  }

  return {
    baseUrl: getVertexServiceEndpoint(provider, location),
    headers: {
      ...defaultAppHeaders(),
      ...authHeaders,
      ...provider.settings?.extraHeaders
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
