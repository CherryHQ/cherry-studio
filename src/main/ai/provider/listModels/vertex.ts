/**
 * Vertex AI model listing helpers — ported from v2 hotfix #14611.
 *
 * Renderer-side originals lived in `src/renderer/src/aiCore/services/listModels/vertex.ts`
 * and pulled credentials from Redux + IPC; backend port reads them straight from
 * the provider's auth config (`iam-gcp`) and calls `vertexAIService` directly.
 */

import { providerService } from '@data/services/ProviderService'
import { loggerService } from '@logger'
import { vertexAIService } from '@main/services/VertexAIService'
import type { Provider } from '@shared/data/types/provider'
import { defaultAppHeaders } from '@shared/utils'
import { withoutTrailingSlash } from '@shared/utils/api/utils'

import { getBaseUrl } from '../../utils/provider'

const logger = loggerService.withContext('VertexModelList')

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

const VERTEX_RESOURCE_PATH_REGEX = /\/v1(?:beta1)?\/projects\/[^/]+\/locations\/[^/]+$/

/** Resolve the Vertex API host. Prefer a user-customized `endpointConfigs` baseUrl
 *  (e.g. through a reverse proxy), otherwise fall back to the regional default. */
function getVertexServiceEndpoint(provider: Provider, location: string): string {
  const apiHost = withoutTrailingSlash(getBaseUrl(provider))
  const defaultHost =
    location === 'global' ? 'https://aiplatform.googleapis.com' : `https://${location}-aiplatform.googleapis.com`

  if (!apiHost || apiHost.endsWith('aiplatform.googleapis.com')) {
    return defaultHost
  }

  if (VERTEX_RESOURCE_PATH_REGEX.test(apiHost)) {
    return apiHost.replace(VERTEX_RESOURCE_PATH_REGEX, '')
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
  const authConfig = await providerService.getAuthConfig(provider.id)
  if (authConfig?.type !== 'iam-gcp') {
    if (options?.throwOnError) {
      throw new Error(`Vertex AI provider is not configured with iam-gcp auth: ${provider.id}`)
    }
    logger.warn('Vertex AI model listing skipped — provider is not configured with iam-gcp auth', {
      providerId: provider.id,
      authType: authConfig?.type
    })
    return undefined
  }

  const { project, location, credentials } = authConfig
  const creds = credentials ?? {}
  const privateKey = (creds.privateKey ?? creds.private_key) as string | undefined
  const clientEmail = (creds.clientEmail ?? creds.client_email) as string | undefined

  const missing: string[] = []
  if (!project) missing.push('project')
  if (!location) missing.push('location')
  if (!privateKey) missing.push('privateKey')
  if (!clientEmail) missing.push('clientEmail')

  if (missing.length > 0) {
    logger.warn('Vertex AI model listing skipped — missing required service-account fields', {
      providerId: provider.id,
      missing
    })
    return undefined
  }

  let authHeaders: Record<string, string>
  try {
    authHeaders = await vertexAIService.getAuthHeaders({
      projectId: project,
      serviceAccount: { privateKey: privateKey!, clientEmail: clientEmail! }
    })
  } catch (error) {
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
  if (markerIndex >= 0) return name.slice(markerIndex + marker.length)
  return name.split('/').pop() || name
}

export function getVertexModelPublisher(name: string): string {
  const marker = 'publishers/'
  const markerIndex = name.indexOf(marker)
  if (markerIndex < 0) return 'google'
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
