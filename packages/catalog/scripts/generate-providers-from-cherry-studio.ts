#!/usr/bin/env tsx

/**
 * Generate providers.json from Cherry Studio provider configuration
 * This script parses the Cherry Studio providers.ts file and converts it to catalog format v2
 * With automatic models_api configuration for OpenAI-compatible providers
 */

import fs from 'fs'
import path from 'path'

// Endpoint types (must match schema)
type EndpointType =
  | 'CHAT_COMPLETIONS'
  | 'TEXT_COMPLETIONS'
  | 'MESSAGES'
  | 'RESPONSES'
  | 'GENERATE_CONTENT'
  | 'EMBEDDINGS'
  | 'RERANK'
  | 'IMAGE_GENERATION'
  | 'IMAGE_EDIT'
  | 'IMAGE_VARIATION'
  | 'AUDIO_TRANSCRIPTION'
  | 'AUDIO_TRANSLATION'
  | 'TEXT_TO_SPEECH'
  | 'VIDEO_GENERATION'

// V2 Provider data structure with formats and models_api
interface ProviderConfig {
  id: string
  name: string
  description: string
  authentication: string
  formats: Array<{
    format: string
    base_url: string
    default?: boolean
  }>
  supported_endpoints: EndpointType[]
  api_compatibility: {
    supports_array_content: boolean
    supports_stream_options: boolean
    supports_developer_role: boolean
    supports_service_tier: boolean
    supports_thinking_control: boolean
    supports_api_version: boolean
  }
  documentation?: string
  website?: string
  deprecated: boolean
  metadata: {
    tags: string[]
  }
  models_api?: {
    endpoints: Array<{
      url: string
      endpoint_type: EndpointType
      format: string
      transformer?: string
    }>
    enabled: boolean
    update_frequency: string
  }
}

// Simple Cherry Studio provider structure (what we parse from the file)
interface CherryStudioProvider {
  id: string
  name: string
  type: string
  apiHost: string
  anthropicApiHost?: string
  docs?: string
  website?: string
}

// Providers to skip (local deployments or special cases)
const SKIP_PROVIDERS = new Set([
  'ollama',
  'lmstudio',
  'new-api',
  'ovms',
  'xinference',
  'vllm',
  'cherryai', // Skip CherryAI as it's a special system provider
  'azure-openai', // Requires special handling
  'vertexai', // Requires special handling
  'aws-bedrock', // Requires special handling
  'ai-gateway', // Requires special handling
  'gpustack' // No API host
])

// Providers without /models API endpoint (no model listing available)
const NO_MODELS_API = new Set(['perplexity', 'cephalon', 'minimax', 'longcat', 'voyageai', 'jina'])

// Providers with custom transformers
const CUSTOM_TRANSFORMERS: Record<string, string> = {
  openrouter: 'openrouter',
  aihubmix: 'aihubmix'
}

// Providers with custom models endpoint
const CUSTOM_ENDPOINTS: Record<string, string> = {
  github: 'https://models.github.ai/inference/models',
  copilot: 'https://api.githubcopilot.com/models'
}

// Compatibility arrays from Cherry Studio
const NOT_SUPPORT_ARRAY_CONTENT = [
  'deepseek',
  'baichuan',
  'minimax',
  'xirang',
  'poe',
  'cephalon'
]

const NOT_SUPPORT_STREAM_OPTIONS = ['mistral']

const NOT_SUPPORT_DEVELOPER_ROLE = ['poe', 'qiniu']

const NOT_SUPPORT_THINKING_CONTROL = ['ollama', 'lmstudio', 'nvidia']

const NOT_SUPPORT_API_VERSION = ['github', 'copilot', 'perplexity']

const NOT_SUPPORT_SERVICE_TIER = ['github', 'copilot', 'cerebras']

/**
 * Parse Cherry Studio providers.ts file to extract provider configurations
 */
function parseCherryStudioProviders(filePath: string): Record<string, CherryStudioProvider> {
  const content = fs.readFileSync(filePath, 'utf-8')
  const providers: Record<string, CherryStudioProvider> = {}

  // Extract PROVIDER_URLS for documentation/website info
  const urlsMatch = content.match(/export const PROVIDER_URLS.*?=\s*{([^}]+(?:{[^}]*}[^}]*)*)\s*}/s)
  const urlsData: Record<string, { docs?: string; website?: string }> = {}

  if (urlsMatch) {
    const urlsContent = urlsMatch[1]
    const providerUrlMatches = urlsContent.matchAll(/['"]?(\w[\w-]*)['"]?\s*:\s*{([^}]+(?:{[^}]*}[^}]*)*?)}/g)

    for (const match of providerUrlMatches) {
      const providerId = match[1]
      const urlConfig = match[2]

      const docsMatch = urlConfig.match(/docs:\s*['"]([^'"]+)['"]/)?.[1]
      const websiteMatch = urlConfig.match(/official:\s*['"]([^'"]+)['"]/)?.[1]

      urlsData[providerId] = {
        docs: docsMatch,
        website: websiteMatch
      }
    }
  }

  // Extract SYSTEM_PROVIDERS_CONFIG
  const configMatch = content.match(/export const SYSTEM_PROVIDERS_CONFIG.*?=\s*{([^]*?)\n}\s+as const/s)

  if (!configMatch) {
    throw new Error('Could not find SYSTEM_PROVIDERS_CONFIG in providers.ts')
  }

  const configContent = configMatch[1]

  // Match each provider block
  const providerMatches = configContent.matchAll(/['"]?([\w-]+)['"]?:\s*{([^}]+(?:{[^}]*}[^}]*)*?)}/gs)

  for (const match of providerMatches) {
    const providerId = match[1]
    const providerConfig = match[2]

    // Skip if in SKIP_PROVIDERS
    if (SKIP_PROVIDERS.has(providerId)) {
      continue
    }

    // Extract fields
    const idMatch = providerConfig.match(/id:\s*['"]([^'"]+)['"]/)?.[1]
    const nameMatch = providerConfig.match(/name:\s*['"]([^'"]+)['"]/)?.[1]
    const typeMatch = providerConfig.match(/type:\s*['"]([^'"]+)['"]/)?.[1]
    const apiHostMatch = providerConfig.match(/apiHost:\s*['"]([^'"]+)['"]/)?.[1]
    const anthropicApiHostMatch = providerConfig.match(/anthropicApiHost:\s*['"]([^'"]+)['"]/)?.[1]

    if (!idMatch || !nameMatch || !typeMatch || !apiHostMatch) {
      continue
    }

    // Only process providers with actual API hosts (not empty or localhost for non-supported ones)
    if (!apiHostMatch || apiHostMatch === '') {
      continue
    }

    providers[providerId] = {
      id: idMatch,
      name: nameMatch,
      type: typeMatch,
      apiHost: apiHostMatch,
      anthropicApiHost: anthropicApiHostMatch,
      docs: urlsData[providerId]?.docs,
      website: urlsData[providerId]?.website
    }
  }

  return providers
}

/**
 * Generate models_api configuration for OpenAI-compatible providers
 */
function generateModelsApiConfig(cherryProvider: CherryStudioProvider): ProviderConfig['models_api'] | undefined {
  // Skip non-OpenAI types
  if (!['openai', 'openai-response'].includes(cherryProvider.type)) {
    return undefined
  }

  // Skip providers without /models API endpoint
  if (NO_MODELS_API.has(cherryProvider.id)) {
    return undefined
  }

  const baseUrl = cherryProvider.apiHost.replace(/\/$/, '')
  const endpoints: ProviderConfig['models_api']['endpoints'] = []

  // Build models endpoint URL for chat completions
  let modelsUrl: string
  if (CUSTOM_ENDPOINTS[cherryProvider.id]) {
    modelsUrl = CUSTOM_ENDPOINTS[cherryProvider.id]
  } else {
    // If base_url already contains version path (/v1, /v2, /v1beta, /v1alpha, etc.), just append /models
    // Otherwise check if provider supports API versioning
    // Matches: /v1, /v2, /v1beta, /v1alpha, /v2beta2, etc.
    if (/\/v\d+(alpha|beta)?(\d+)?/.test(baseUrl)) {
      modelsUrl = `${baseUrl}/models`
    } else if (NOT_SUPPORT_API_VERSION.includes(cherryProvider.id)) {
      // Providers that don't support /v1/ prefix, use /models directly
      modelsUrl = `${baseUrl}/models`
    } else {
      modelsUrl = `${baseUrl}/v1/models`
    }
  }

  // Chat completions endpoint (most common)
  endpoints.push({
    url: modelsUrl,
    endpoint_type: 'CHAT_COMPLETIONS',
    format: 'OPENAI',
    ...(CUSTOM_TRANSFORMERS[cherryProvider.id] && {
      transformer: CUSTOM_TRANSFORMERS[cherryProvider.id]
    })
  })

  // Determine update frequency based on provider type
  const updateFrequency = ['openrouter', 'aihubmix'].includes(cherryProvider.id)
    ? 'realtime' // Aggregators change frequently
    : 'daily' // Official providers change less often

  return {
    endpoints,
    enabled: true,
    update_frequency: updateFrequency
  }
}

/**
 * Generate supported endpoints based on provider type
 */
function generateSupportedEndpoints(cherryProvider: CherryStudioProvider): EndpointType[] {
  const endpoints: EndpointType[] = []

  switch (cherryProvider.type) {
    case 'openai':
    case 'openai-response':
      // OpenAI-compatible providers support chat completions
      endpoints.push('CHAT_COMPLETIONS')

      // OpenAI official and some aggregators support more endpoints
      if (['openai', 'openrouter', 'together'].includes(cherryProvider.id)) {
        endpoints.push('EMBEDDINGS')
      }

      // OpenAI official supports images, audio, and responses API
      if (cherryProvider.id === 'openai') {
        endpoints.push('RESPONSES', 'IMAGE_GENERATION', 'AUDIO_TRANSCRIPTION', 'TEXT_TO_SPEECH')
      }

      // If provider has anthropicApiHost, it also supports MESSAGES
      if (cherryProvider.anthropicApiHost) {
        endpoints.push('MESSAGES')
      }
      break

    case 'anthropic':
      // Anthropic uses Messages API
      endpoints.push('MESSAGES')
      break

    case 'gemini':
      // Gemini uses generateContent API
      endpoints.push('GENERATE_CONTENT')
      // Gemini also supports embeddings
      endpoints.push('EMBEDDINGS')
      break

    default:
      // Default to chat completions for unknown types
      endpoints.push('CHAT_COMPLETIONS')
  }

  return endpoints
}

/**
 * Create catalog provider config from Cherry Studio config
 */
function createProviderConfig(cherryProvider: CherryStudioProvider): ProviderConfig {
  const formats: ProviderConfig['formats'] = []

  // Add OpenAI format for openai-type providers
  if (cherryProvider.type === 'openai' || cherryProvider.type === 'openai-response') {
    formats.push({
      format: 'OPENAI',
      base_url: cherryProvider.apiHost,
      default: true
    })
  }

  // Add Anthropic format if anthropicApiHost is present
  if (cherryProvider.anthropicApiHost) {
    formats.push({
      format: 'ANTHROPIC',
      base_url: cherryProvider.anthropicApiHost
    })
  }

  // For native Anthropic/Gemini providers
  if (cherryProvider.type === 'anthropic') {
    formats.push({
      format: 'ANTHROPIC',
      base_url: cherryProvider.apiHost,
      default: true
    })
  }

  if (cherryProvider.type === 'gemini') {
    formats.push({
      format: 'GEMINI',
      base_url: cherryProvider.apiHost,
      default: true
    })
  }

  const provider: ProviderConfig = {
    id: cherryProvider.id,
    name: cherryProvider.name,
    description: `${cherryProvider.name} - AI model provider`,
    authentication: 'API_KEY',
    formats,
    supported_endpoints: generateSupportedEndpoints(cherryProvider),
    api_compatibility: {
      supports_array_content: !NOT_SUPPORT_ARRAY_CONTENT.includes(cherryProvider.id),
      supports_stream_options: !NOT_SUPPORT_STREAM_OPTIONS.includes(cherryProvider.id),
      supports_developer_role: !NOT_SUPPORT_DEVELOPER_ROLE.includes(cherryProvider.id),
      supports_thinking_control: !NOT_SUPPORT_THINKING_CONTROL.includes(cherryProvider.id),
      supports_api_version: !NOT_SUPPORT_API_VERSION.includes(cherryProvider.id),
      supports_service_tier: !NOT_SUPPORT_SERVICE_TIER.includes(cherryProvider.id)
    },
    documentation: cherryProvider.docs,
    website: cherryProvider.website,
    deprecated: false,
    metadata: {
      tags: cherryProvider.type === 'openai' ? ['aggregator'] : ['official']
    }
  }

  // Add models_api config
  const modelsApi = generateModelsApiConfig(cherryProvider)
  if (modelsApi) {
    provider.models_api = modelsApi
  }

  return provider
}

async function generateProvidersJson() {
  console.log('Generating providers.json from Cherry Studio configuration...\n')

  // Path to Cherry Studio providers.ts
  const cherryStudioPath = path.resolve(__dirname, '../../../src/renderer/src/config/providers.ts')

  if (!fs.existsSync(cherryStudioPath)) {
    throw new Error(`Cherry Studio providers.ts not found at: ${cherryStudioPath}`)
  }

  // Parse Cherry Studio providers
  const cherryProviders = parseCherryStudioProviders(cherryStudioPath)
  console.log(`Found ${Object.keys(cherryProviders).length} providers in Cherry Studio config`)

  // Convert to catalog format
  const providers = Object.values(cherryProviders).map(createProviderConfig)

  const withModelsApi = providers.filter((p) => p.models_api)
  console.log(`Generated ${providers.length} providers`)
  console.log(`  - With models_api: ${withModelsApi.length}`)
  console.log(`  - Without models_api: ${providers.length - withModelsApi.length}\n`)

  const output = {
    version: new Date().toISOString().split('T')[0].replace(/-/g, '.'),
    providers
  }

  const outputPath = path.join(__dirname, '../data/providers.json')
  await fs.promises.writeFile(outputPath, JSON.stringify(output, null, 2) + '\n', 'utf-8')

  console.log(`✓ Saved to ${outputPath}`)

  // List providers with models_api
  console.log('\nProviders with models_api:')
  withModelsApi.forEach((p) => {
    const endpoint = p.models_api!.endpoints[0]
    console.log(
      `  - ${p.id.padEnd(20)} ${endpoint.url}${endpoint.transformer ? ` (transformer: ${endpoint.transformer})` : ''}`
    )
  })

  // List skipped providers
  console.log(`\nSkipped ${SKIP_PROVIDERS.size} providers: ${Array.from(SKIP_PROVIDERS).join(', ')}`)
}

generateProvidersJson().catch(console.error)
