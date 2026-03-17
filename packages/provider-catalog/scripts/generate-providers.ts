#!/usr/bin/env tsx

/**
 * Generate providers.json from Cherry Studio provider configuration
 * This script parses the Cherry Studio providers.ts file and converts it to catalog format
 *
 * Output format matches ProviderConfigSchema:
 * - baseUrls: Record<EndpointType, URL>
 * - modelsApiUrls: { default?, embedding?, reranker? }
 * - apiFeatures: object with feature flags
 * - metadata: includes website { official, docs, apiKey }
 */

import fs from 'fs'
import path from 'path'

import { ENDPOINT_TYPE, type EndpointType, type ProviderConfig, type ProviderReasoningFormat } from '../src/schemas'
import { writeProviders } from './shared/catalog-io'

type CherryStudioProviderType =
  | 'openai'
  | 'openai-response'
  | 'anthropic'
  | 'gemini'
  | 'azure-openai'
  | 'vertexai'
  | 'mistral'
  | 'aws-bedrock'
  | 'vertex-anthropic'
  | 'new-api'
  | 'gateway'
  | 'ollama'

interface CherryStudioProvider {
  id: string
  name: string
  type: CherryStudioProviderType
  apiHost: string
  anthropicApiHost?: string
  docs?: string
  website?: string
  apiKey?: string
}

// Providers registered as minimal/empty (no modelsApiUrls, no complex config)
// These are local deployments, special cases, or require special handling
const MINIMAL_PROVIDERS = new Set([
  'ollama',
  'lmstudio',
  'new-api',
  'ovms',
  'xinference',
  'vllm',
  'cherryai', // Special system provider
  'azure-openai', // Requires special handling
  'vertexai', // Requires special handling
  'aws-bedrock', // Requires special handling
  'ai-gateway', // Requires special handling
  'gpustack' // No API host
])

// Providers without /models API endpoint (no model listing available)
const NO_MODELS_API = new Set(['cephalon', 'voyageai', 'perplexity', 'longcat', 'minimax'])

// Providers with custom models endpoint (default URL only)
const CUSTOM_ENDPOINTS: Record<string, string> = {
  github: 'https://models.github.ai/catalog/models',
  copilot: 'https://api.githubcopilot.com/models'
}

// Providers with multiple models API endpoints (different model types)
const MULTI_ENDPOINT_PROVIDERS: Record<string, { default?: string; embedding?: string; reranker?: string }> = {
  openrouter: {
    default: 'https://openrouter.ai/api/v1/models',
    embedding: 'https://openrouter.ai/api/v1/embeddings/models'
  },
  ppio: {
    default: 'https://api.ppinfra.com/v3/openai/models',
    embedding: 'https://api.ppinfra.com/v3/openai/models?model_type=embedding',
    reranker: 'https://api.ppinfra.com/v3/openai/models?model_type=reranker'
  }
}

// Compatibility arrays from Cherry Studio
const NOT_SUPPORT_ARRAY_CONTENT = ['deepseek', 'baichuan', 'minimax', 'xirang', 'poe', 'cephalon']

const NOT_SUPPORT_STREAM_OPTIONS = ['mistral']

const NOT_SUPPORT_DEVELOPER_ROLE = ['poe', 'qiniu']

// Provider reasoning format — describes HOW the provider's API expects reasoning parameters.
// Type values match ProviderReasoningFormatSchema discriminated union.
const PROVIDER_REASONING_FORMAT: Record<string, ProviderReasoningFormat['type']> = {
  // Official SDKs
  openai: 'openai-chat',
  anthropic: 'anthropic',
  gemini: 'gemini',
  google: 'gemini',

  // OpenRouter — reasoning: { effort } format
  openrouter: 'openrouter',

  // DashScope — enableThinking + incrementalOutput
  dashscope: 'dashscope',
  modelscope: 'dashscope',

  // enable_thinking + thinkingBudget (Qwen-compatible providers)
  silicon: 'enable-thinking',
  qiniu: 'enable-thinking',

  // thinking: { type: 'enabled' } (Doubao/generic thinking-type providers)
  doubao: 'thinking-type',
  zhipu: 'thinking-type',
  deepseek: 'thinking-type',
  hunyuan: 'thinking-type',
  'tencent-cloud-ti': 'thinking-type',
  aihubmix: 'thinking-type',
  sophnet: 'thinking-type',
  ppio: 'thinking-type',
  dmxapi: 'thinking-type',
  stepfun: 'thinking-type',
  infini: 'thinking-type',
  baichuan: 'thinking-type'
}

/**
 * Parse Cherry Studio providers.ts file to extract provider configurations
 */
function parseCherryStudioProviders(filePath: string): Record<string, CherryStudioProvider> {
  const content = fs.readFileSync(filePath, 'utf-8')
  const providers: Record<string, CherryStudioProvider> = {}

  // Extract PROVIDER_URLS for documentation/website info
  const urlsMatch = content.match(/export const PROVIDER_URLS.*?=\s*{([^}]+(?:{[^}]*}[^}]*)*)\s*}/s)
  const urlsData: Record<string, { docs?: string; website?: string; apiKey?: string }> = {}

  if (urlsMatch) {
    const urlsContent = urlsMatch[1]
    const providerUrlMatches = urlsContent.matchAll(/['"]?(\w[\w-]*)['"]?\s*:\s*{([^}]+(?:{[^}]*}[^}]*)*?)}/g)

    for (const match of providerUrlMatches) {
      const providerId = match[1]
      const urlConfig = match[2]

      const docsMatch = urlConfig.match(/docs:\s*['"]([^'"]+)['"]/)?.[1]
      const websiteMatch = urlConfig.match(/official:\s*['"]([^'"]+)['"]/)?.[1]
      const apiKeyMatch = urlConfig.match(/apiKey:\s*['"]([^'"]+)['"]/)?.[1]
      urlsData[providerId] = {
        docs: docsMatch,
        website: websiteMatch,
        apiKey: apiKeyMatch
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

    // Extract fields
    const idMatch = providerConfig.match(/id:\s*['"]([^'"]+)['"]/)?.[1]
    const nameMatch = providerConfig.match(/name:\s*['"]([^'"]+)['"]/)?.[1]
    const typeMatch = providerConfig.match(/type:\s*['"]([^'"]+)['"]/)?.[1] as CherryStudioProviderType
    const apiHostMatch = providerConfig.match(/apiHost:\s*['"]([^'"]+)['"]/)?.[1]
    const anthropicApiHostMatch = providerConfig.match(/anthropicApiHost:\s*['"]([^'"]+)['"]/)?.[1]

    // Minimal providers only need id and name
    if (MINIMAL_PROVIDERS.has(providerId)) {
      if (idMatch && nameMatch) {
        providers[providerId] = {
          id: idMatch,
          name: nameMatch,
          type: typeMatch || 'openai',
          apiHost: apiHostMatch || '',
          anthropicApiHost: anthropicApiHostMatch,
          docs: urlsData[providerId]?.docs,
          website: urlsData[providerId]?.website
        }
      }
      continue
    }

    // Regular providers need all fields
    if (!idMatch || !nameMatch || !typeMatch || !apiHostMatch) {
      continue
    }

    // Only process providers with actual API hosts
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
      website: urlsData[providerId]?.website,
      apiKey: urlsData[providerId]?.apiKey
    }
  }

  return providers
}

/**
 * Build baseUrls Record from Cherry Studio provider
 * Maps endpoint types to base URLs
 */
function buildBaseUrls(cherryProvider: CherryStudioProvider): Record<string, string> {
  const baseUrls: Partial<Record<EndpointType, string>> = {}
  const apiHost = cherryProvider.apiHost.replace(/\/$/, '')

  // Map the default endpoint type based on provider type
  const defaultEndpoint = getDefaultChatEndpoint(cherryProvider) ?? ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
  baseUrls[defaultEndpoint] = apiHost

  // If provider has anthropicApiHost, MESSAGES endpoint uses different host
  if (cherryProvider.anthropicApiHost) {
    baseUrls[ENDPOINT_TYPE.ANTHROPIC_MESSAGES] = cherryProvider.anthropicApiHost.replace(/\/$/, '')
  }

  return baseUrls
}

/**
 * Determine the default chat endpoint for a provider
 */
function getDefaultChatEndpoint(cherryProvider: CherryStudioProvider): EndpointType | undefined {
  switch (cherryProvider.type) {
    case 'openai':
      return ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
    case 'openai-response':
      return ENDPOINT_TYPE.OPENAI_RESPONSES
    case 'anthropic':
      return ENDPOINT_TYPE.ANTHROPIC_MESSAGES
    case 'gemini':
      return ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT
    case 'ollama':
      return ENDPOINT_TYPE.OLLAMA_CHAT
    default:
      return ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
  }
}

// Providers with non-standard models API URLs (not derived from baseUrls)
const CUSTOM_MODELS_API: Record<string, { default: string }> = {
  gemini: { default: 'https://generativelanguage.googleapis.com/v1beta/models' },
  gateway: { default: 'https://ai-gateway.vercel.sh/v1/ai/config' }
}

/**
 * Generate modelsApiUrls for the provider (object format with multiple URL types)
 */
function generateModelsApiUrls(
  cherryProvider: CherryStudioProvider
): { default?: string; embedding?: string; reranker?: string } | undefined {
  // Skip providers without /models API endpoint
  if (NO_MODELS_API.has(cherryProvider.id)) {
    return undefined
  }

  // Check for providers with non-standard models API URLs
  if (CUSTOM_MODELS_API[cherryProvider.id]) {
    return CUSTOM_MODELS_API[cherryProvider.id]
  }

  // Check for providers with multiple endpoints
  if (MULTI_ENDPOINT_PROVIDERS[cherryProvider.id]) {
    return MULTI_ENDPOINT_PROVIDERS[cherryProvider.id]
  }

  // Custom single endpoints
  if (CUSTOM_ENDPOINTS[cherryProvider.id]) {
    return { default: CUSTOM_ENDPOINTS[cherryProvider.id] }
  }

  // Skip minimal providers (no base URL to derive from)
  if (MINIMAL_PROVIDERS.has(cherryProvider.id)) {
    return undefined
  }

  const baseUrl = cherryProvider.apiHost.replace(/\/$/, '')
  if (!baseUrl) return undefined

  // Standard endpoint: derive from apiHost
  // Anthropic: https://api.anthropic.com → https://api.anthropic.com/v1/models
  // OpenAI: https://api.openai.com → https://api.openai.com/v1/models
  const hasVersionPath = /\/v\d+(alpha|beta)?(\d+)?/.test(baseUrl)
  const defaultUrl = hasVersionPath ? `${baseUrl}/models` : `${baseUrl}/v1/models`

  return { default: defaultUrl }
}

/**
 * Build apiFeatures object (only include non-default values)
 */
function buildApiFeatures(cherryProvider: CherryStudioProvider): ProviderConfig['apiFeatures'] | undefined {
  const compat: ProviderConfig['apiFeatures'] = {}
  let hasNonDefault = false

  // Default is true, so only set if false
  if (NOT_SUPPORT_ARRAY_CONTENT.includes(cherryProvider.id)) {
    compat.arrayContent = false
    hasNonDefault = true
  }

  if (NOT_SUPPORT_STREAM_OPTIONS.includes(cherryProvider.id)) {
    compat.streamOptions = false
    hasNonDefault = true
  }

  if (NOT_SUPPORT_DEVELOPER_ROLE.includes(cherryProvider.id)) {
    compat.developerRole = false
    hasNonDefault = true
  }

  // Default is false, so only set if true
  if (cherryProvider.id === 'openai') {
    compat.serviceTier = true
    hasNonDefault = true
  }

  return hasNonDefault ? compat : undefined
}

/**
 * Create catalog provider config from Cherry Studio config
 */
function createProviderConfig(cherryProvider: CherryStudioProvider): ProviderConfig {
  // Minimal providers get only basic info with empty baseUrls
  if (MINIMAL_PROVIDERS.has(cherryProvider.id)) {
    return {
      id: cherryProvider.id,
      name: cherryProvider.name,
      description: `${cherryProvider.name} - AI model provider`,
      metadata: {
        source: 'cherry-studio',
        tags: ['minimal'],
        website: {
          official: cherryProvider.website || '',
          docs: cherryProvider.docs || '',
          apiKey: ''
        }
      }
    }
  }

  const baseUrls = buildBaseUrls(cherryProvider)
  const defaultChatEndpoint = getDefaultChatEndpoint(cherryProvider)
  const apiFeatures = buildApiFeatures(cherryProvider)
  const modelsApiUrls = generateModelsApiUrls(cherryProvider)
  const reasoningFormatType = PROVIDER_REASONING_FORMAT[cherryProvider.id]
  const reasoningFormat: ProviderReasoningFormat | undefined = reasoningFormatType
    ? { type: reasoningFormatType }
    : undefined

  // Determine tags based on provider type
  const isAggregator = ['openrouter', 'aihubmix', 'together', 'newapi'].includes(cherryProvider.id)

  return {
    id: cherryProvider.id,
    name: cherryProvider.name,
    description: `${cherryProvider.name} - AI model provider`,
    baseUrls: baseUrls,
    defaultChatEndpoint: defaultChatEndpoint,
    apiFeatures: apiFeatures,
    modelsApiUrls: modelsApiUrls,
    reasoningFormat: reasoningFormat,
    metadata: {
      source: 'cherry-studio',
      tags: isAggregator ? ['aggregator'] : ['official'],
      website: {
        official: cherryProvider.website || '',
        docs: cherryProvider.docs || '',
        apiKey: ''
      }
    }
  }
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

  const withModelsApi = providers.filter((p) => p.modelsApiUrls)
  console.log(`Generated ${providers.length} providers`)
  console.log(`  - With modelsApiUrls: ${withModelsApi.length}`)
  console.log(`  - Without modelsApiUrls: ${providers.length - withModelsApi.length}\n`)

  const output = {
    version: new Date().toISOString().split('T')[0].replace(/-/g, '.'),
    providers
  }

  // Write protobuf binary
  const pbOutputPath = path.join(__dirname, '../data/providers.pb')
  writeProviders(pbOutputPath, output)

  // Also write JSON for debugging/inspection
  const jsonOutputPath = path.join(__dirname, '../data/providers.json')
  await fs.promises.writeFile(jsonOutputPath, JSON.stringify(output, null, 2) + '\n', 'utf-8')

  console.log(`✓ Saved to ${pbOutputPath} and ${jsonOutputPath}`)

  // List providers with modelsApiUrls
  console.log('\nProviders with modelsApiUrls:')
  withModelsApi.forEach((p) => {
    const urls = p.modelsApiUrls!
    const urlList = Object.entries(urls)
      .filter(([, url]) => url)
      .map(([type, url]) => `${type}=${url}`)
      .join(', ')
    console.log(`  - ${p.id.padEnd(20)} ${urlList}`)
  })

  // List minimal providers
  const minimalProviders = providers.filter((p) => MINIMAL_PROVIDERS.has(p.id))
  console.log(`\nMinimal providers (${minimalProviders.length}): ${minimalProviders.map((p) => p.id).join(', ')}`)
}

generateProvidersJson().catch(console.error)
