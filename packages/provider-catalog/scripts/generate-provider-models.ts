#!/usr/bin/env tsx

/**
 * Generate provider-models.json by fetching from provider APIs
 *
 * Logic:
 * 1. Read providers.json to get modelsApiUrls for each provider
 * 2. Fetch models from each provider's API
 * 3. Normalize model IDs
 * 4. If normalized ID NOT in models.json → add to models.json
 * 5. If normalized ID EXISTS in models.json → add to provider-models.json with apiModelId
 *
 * Most providers use OpenAI-compatible /v1/models format.
 * Special parsers are only needed for providers with rich metadata (pricing, limits).
 *
 * API Keys:
 * - Copy .env.example to .env and fill in your API keys
 * - Or set environment variables directly (e.g., OPENAI_API_KEY=xxx)
 */

import * as dotenv from 'dotenv'

// Load .env file with override to take precedence over system env vars (e.g., from .zshrc)
dotenv.config({ override: true })

import * as fs from 'fs'
import * as path from 'path'

import {
  type EndpointType,
  type Modality,
  ModelCapability,
  type ModelConfig,
  type ProviderConfig,
  type ProviderModelOverride
} from '../src/schemas'
import {
  extractParameterSize,
  extractVariantSuffix,
  inferCapabilitiesFromModelId,
  inferPublisherFromModelId,
  normalizeModelId,
  normalizeVersionSeparators,
  stripVariantSuffixes
} from '../src/utils/importers/base/base-transformer'
// Import parsers from provider-parsers module
import {
  type ParserFn,
  PROVIDER_FETCH_OPTIONS,
  type ProviderModelEntry,
  SPECIAL_PARSERS as IMPORTED_SPECIAL_PARSERS
} from './provider-parsers'
// Import shared API key configuration
import { getApiKey, getAuthHeaders } from './shared/api-keys'

const DATA_DIR = path.join(__dirname, '../data')

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

interface ModelsDataFile {
  version: string
  models: ModelConfig[]
}

interface ProvidersDataFile {
  version: string
  providers: ProviderConfig[]
}

// Re-export ProviderModelEntry type for local use
export type { ProviderModelEntry }

// ═══════════════════════════════════════════════════════════════════════════════
// Generic OpenAI-compatible Response Parser
// Most providers return this format from /v1/models
// ═══════════════════════════════════════════════════════════════════════════════

interface OpenAIModelEntry {
  id: string
  object?: string
  created?: number
  owned_by?: string
}

interface OpenAIModelsResponse {
  data: OpenAIModelEntry[]
  object?: string
}

function parseGenericOpenAIResponse(data: unknown): ProviderModelEntry[] {
  const response = data as OpenAIModelsResponse

  if (!response?.data || !Array.isArray(response.data)) {
    throw new Error('Invalid response: expected { data: [...] }')
  }

  return response.data
    .filter((m) => m.id && typeof m.id === 'string')
    .map((m) => {
      const originalId = m.id
      const { baseId, variant, parameterSize } = extractVariantAndSize(originalId)

      return {
        originalId,
        normalizedId: normalizeModelId(baseId),
        variant,
        parameterSize,
        ownedBy: m.owned_by
        // No pricing/limits info in generic format
      }
    })
}

// ═══════════════════════════════════════════════════════════════════════════════
// Anthropic Parser
// ═══════════════════════════════════════════════════════════════════════════════

interface AnthropicModel {
  id: string
  display_name: string
  type: string
  created_at?: string
}

interface AnthropicResponse {
  data: AnthropicModel[]
}

function parseAnthropicResponse(data: unknown): ProviderModelEntry[] {
  const response = data as AnthropicResponse

  if (!response?.data || !Array.isArray(response.data)) {
    throw new Error('Invalid Anthropic response: expected { data: [...] }')
  }

  return response.data
    .filter((m) => m.id && typeof m.id === 'string' && m.type === 'model')
    .map((m) => {
      const originalId = m.id
      const { baseId, variant, parameterSize } = extractVariantAndSize(originalId)

      return {
        originalId,
        normalizedId: normalizeModelId(baseId),
        variant,
        parameterSize,
        name: m.display_name
      }
    })
}

/**
 * Parse PH8 API response (may have different format)
 */
function parsePH8Response(data: unknown): ProviderModelEntry[] {
  // Try array format first
  if (Array.isArray(data)) {
    return data
      .filter((m: any) => m.id && typeof m.id === 'string')
      .map((m: any) => {
        const originalId = m.id
        const { baseId, variant, parameterSize } = extractVariantAndSize(originalId)
        return {
          originalId,
          normalizedId: normalizeModelId(baseId),
          variant,
          parameterSize,
          name: m.name || m.id
        }
      })
  }
  // Fall back to standard format
  return parseGenericOpenAIResponse(data)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Provider Parser Registry
// Combines imported parsers with local ones
// ═══════════════════════════════════════════════════════════════════════════════

const SPECIAL_PARSERS: Record<string, ParserFn> = {
  // Imported from provider-parsers module (with Zod validation)
  // These take precedence over local parsers for google, gemini, github
  ...IMPORTED_SPECIAL_PARSERS,

  // Aliases for providers whose ID differs from the parser registry key
  gateway: IMPORTED_SPECIAL_PARSERS['vercel-gateway'],

  // Local parsers (only for providers without dedicated parser modules)
  anthropic: parseAnthropicResponse,
  ph8: parsePH8Response
}

/**
 * Map provider IDs to their parser/fetch-options registry keys
 * Used when the provider ID in providers.json differs from the key in SPECIAL_PARSERS / PROVIDER_FETCH_OPTIONS
 */
const PROVIDER_ID_ALIASES: Record<string, string> = {
  gateway: 'vercel-gateway'
}

/** Resolve provider ID to the key used in parser/fetch-options registries */
function resolveParserKey(providerId: string): string {
  return PROVIDER_ID_ALIASES[providerId] ?? providerId
}

function getParser(providerId: string): ParserFn {
  return SPECIAL_PARSERS[providerId] || parseGenericOpenAIResponse
}

// ═══════════════════════════════════════════════════════════════════════════════
// ID Normalization (using shared functions from base-transformer)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Extract variant suffix and parameter size from model ID
 */
function extractVariantAndSize(id: string): { baseId: string; variant: string | null; parameterSize: string | null } {
  let baseId = id
  const variant = extractVariantSuffix(id) || null

  if (variant) {
    // Remove variant suffix to get base ID
    baseId = stripVariantSuffixes(id)
  }

  // Normalize version separators before extracting parameter size
  const normalizedBaseId = normalizeVersionSeparators(baseId.toLowerCase())
  const parameterSize = extractParameterSize(normalizedBaseId) || null

  return { baseId, variant, parameterSize }
}

/**
 * Combine parameter size and variant into a single modelVariant string
 * Examples:
 * - ("72b", null) → "72b"
 * - (null, "free") → "free"
 * - ("72b", "free") → "72b-free"
 * - (null, null) → null
 */
function combineVariants(parameterSize: string | null, variant: string | null): string | null {
  if (parameterSize && variant) {
    return `${parameterSize}-${variant}`
  }
  return parameterSize || variant || null
}

/**
 * Infer publisher from model ID (using shared function)
 */
function inferPublisher(modelId: string): string | undefined {
  return inferPublisherFromModelId(modelId)
}

// ═══════════════════════════════════════════════════════════════════════════════
// API Fetching
// ═══════════════════════════════════════════════════════════════════════════════

async function fetchProviderModels(providerId: string, modelsApiUrl: string): Promise<ProviderModelEntry[]> {
  const parser = getParser(providerId)
  const apiKey = getApiKey(providerId)

  console.log(`    - Fetching ${modelsApiUrl}${apiKey ? ' (with API key)' : ''}`)

  // Build headers using shared auth helper
  const headers: Record<string, string> = {
    ...getAuthHeaders(providerId, apiKey)
  }

  // Check for provider-specific fetch options (e.g., Vercel AI Gateway)
  const parserKey = resolveParserKey(providerId)
  const fetchOptionsGetter = PROVIDER_FETCH_OPTIONS[parserKey] || PROVIDER_FETCH_OPTIONS[providerId]
  if (fetchOptionsGetter) {
    const options = fetchOptionsGetter()
    if (options.headers) {
      Object.assign(headers, options.headers)
    }
  }

  const response = await fetch(modelsApiUrl, { headers })
  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`)
  }

  const data = await response.json()
  return parser(data)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Comparison Utilities
// ═══════════════════════════════════════════════════════════════════════════════

function comparePricing(
  base: ModelConfig['pricing'],
  provider: ProviderModelEntry['pricing']
): ProviderModelOverride['pricing'] | null {
  if (!provider) return null
  if (!base) {
    return {
      input: { perMillionTokens: provider.input, currency: provider.currency },
      output: { perMillionTokens: provider.output, currency: provider.currency },
      ...(provider.cacheRead != null && {
        cacheRead: { perMillionTokens: provider.cacheRead, currency: provider.currency }
      }),
      ...(provider.cacheWrite != null && {
        cacheWrite: { perMillionTokens: provider.cacheWrite, currency: provider.currency }
      })
    }
  }

  const inputDiff = provider.input !== base.input?.perMillionTokens
  const outputDiff = provider.output !== base.output?.perMillionTokens
  const cacheReadDiff = provider.cacheRead !== base.cacheRead?.perMillionTokens
  const cacheWriteDiff = provider.cacheWrite !== base.cacheWrite?.perMillionTokens

  if (!inputDiff && !outputDiff && !cacheReadDiff && !cacheWriteDiff) {
    return null
  }

  return {
    input: { perMillionTokens: provider.input, currency: provider.currency },
    output: { perMillionTokens: provider.output, currency: provider.currency },
    ...(provider.cacheRead != null && {
      cacheRead: { perMillionTokens: provider.cacheRead, currency: provider.currency }
    }),
    ...(provider.cacheWrite != null && {
      cacheWrite: { perMillionTokens: provider.cacheWrite, currency: provider.currency }
    })
  }
}

function compareLimits(base: ModelConfig, provider: ProviderModelEntry): ProviderModelOverride['limits'] | null {
  const diff: ProviderModelOverride['limits'] = {}
  let hasDiff = false

  if (provider.contextWindow && provider.contextWindow !== base.contextWindow) {
    diff.contextWindow = provider.contextWindow
    hasDiff = true
  }
  if (provider.maxOutputTokens && provider.maxOutputTokens !== base.maxOutputTokens) {
    diff.maxOutputTokens = provider.maxOutputTokens
    hasDiff = true
  }

  return hasDiff ? diff : null
}

// Reasoning type mapping based on provider
// Maps provider IDs to their reasoning control format
// Based on renderer aiCore/utils/reasoning.ts getReasoningEffort() branch logic
const PROVIDER_REASONING_TYPE: Record<string, string> = {
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

  // Qwen-compatible — enableThinking + thinkingBudget
  silicon: 'qwen',
  qiniu: 'qwen',

  // Doubao/Thinking — thinking: { type: 'enabled' }
  doubao: 'doubao',
  zhipu: 'doubao',
  deepseek: 'doubao',
  hunyuan: 'doubao',
  'tencent-cloud-ti': 'doubao',
  aihubmix: 'doubao',
  sophnet: 'doubao',
  ppio: 'doubao',
  dmxapi: 'doubao',
  stepfun: 'doubao',
  infini: 'doubao',
  baichuan: 'doubao',
  minimax: 'doubao',
  cerebras: 'doubao',
  mimo: 'doubao',

  // Self-hosted/Nvidia — chatTemplateKwargs
  nvidia: 'self-hosted',

  // Poe — extra_body wrapper (handled internally)
  poe: 'openai-chat',

  // Grok — reasoning_effort
  grok: 'openai-chat',

  // Aggregators/proxies — doubao format (thinking: { type })
  cherryin: 'doubao',
  ocoolai: 'doubao',
  aionly: 'doubao',
  burncloud: 'doubao',
  tokenflux: 'doubao',
  '302ai': 'doubao',
  lanyun: 'doubao',
  ph8: 'doubao',
  'new-api': 'doubao',

  // GitHub/Copilot — reasoning_effort
  github: 'openai-chat',
  copilot: 'openai-chat',

  // Other providers with reasoning_effort
  groq: 'openai-chat',
  together: 'openai-chat',
  fireworks: 'openai-chat',
  hyperbolic: 'openai-chat',
  mistral: 'openai-chat',
  perplexity: 'openai-chat',
  huggingface: 'openai-chat',
  'gitee-ai': 'openai-chat'
}

function generateReasoningConfig(
  baseModel: ModelConfig,
  hasReasoning: boolean,
  providerId: string
): ProviderModelOverride['reasoning'] | null {
  // Check if model has REASONING capability (from import-stage inference or provider API)
  const isReasoning = hasReasoning || baseModel.capabilities?.includes(ModelCapability.REASONING)
  if (!isReasoning) return null

  // Look up provider's reasoning type
  const reasoningType = PROVIDER_REASONING_TYPE[providerId]
  if (!reasoningType) return null

  // If base model already has reasoning config with the same type, no override needed
  if (baseModel.reasoning?.type === reasoningType) return null

  // Generate provider-specific reasoning config (type only, no params)
  // supportedEfforts and thinkingTokenLimits are inherited from base model
  switch (reasoningType) {
    case 'openai-chat':
      return { type: 'openai-chat' }
    case 'openrouter':
      return { type: 'openrouter' }
    case 'anthropic':
      return { type: 'anthropic' }
    case 'gemini':
      return { type: 'gemini' }
    case 'qwen':
      return { type: 'qwen' }
    case 'doubao':
      return { type: 'doubao' }
    case 'dashscope':
      return { type: 'dashscope' }
    case 'self-hosted':
      return { type: 'self-hosted' }
    default:
      return null
  }
}

// Non-language-model capabilities — models with these are NOT language models
const NON_LANGUAGE_CAPABILITIES = new Set([
  'embedding',
  'rerank',
  'image_generation',
  'video_generation',
  'audio_transcript',
  'audio_generation'
])

// Non-language-model ID patterns (fallback when capabilities are empty)
const NON_LANGUAGE_ID_PATTERN =
  /\b(embed|embedding|bge-|e5-|gte-|rerank|dall-e|stable-diffusion|sd3|sdxl|flux|imagen|ideogram|sora|runway|pika|kling|veo|vidu|wan|whisper|tts-|recraft|eleven)\b/i

/**
 * Providers that support web search for all their language models
 * OpenRouter provides web search via the `web` plugin for all chat models
 */
const PROVIDERS_WITH_UNIVERSAL_WEB_SEARCH = new Set(['openrouter'])

/**
 * Providers whose APIs natively support PDF/file input for all language models
 * Based on renderer modelCapabilities.ts supportsPdfInput() — provider-level feature
 * The actual file handling is done by the provider API, not the model itself
 */
const PROVIDERS_WITH_FILE_INPUT = new Set(['openai', 'anthropic', 'gemini'])

/**
 * Check if a model is a language/chat model (not embedding, rerank, image gen, etc.)
 */
function isLanguageModel(model: ModelConfig): boolean {
  const caps = model.capabilities || []
  // If model has non-language capabilities as its primary function, it's not a language model
  if (caps.length > 0 && caps.every((c) => NON_LANGUAGE_CAPABILITIES.has(c))) {
    return false
  }
  // Fallback: check model ID patterns for models with no/few capabilities
  if (caps.length === 0 && NON_LANGUAGE_ID_PATTERN.test(model.id)) {
    return false
  }
  return true
}

/**
 * Generate endpointTypes override for a provider model entry
 *
 * Only writes endpointTypes if the model's endpoints differ from the provider's default.
 * This keeps provider-models.json minimal — omitting the field means "use provider default".
 */
function generateEndpointTypesOverride(
  providerModel: ProviderModelEntry,
  provider: ProviderConfig
): EndpointType[] | undefined {
  if (!providerModel.endpointTypes?.length) return undefined

  const defaultEndpoint = provider.defaultChatEndpoint
  const isOnlyDefault = providerModel.endpointTypes.length === 1 && providerModel.endpointTypes[0] === defaultEndpoint

  // Don't write if the model only supports the provider's default endpoint
  if (isOnlyDefault) return undefined

  return providerModel.endpointTypes as EndpointType[]
}

/**
 * Generate capability overrides for provider-specific features
 * - OpenRouter adds WEB_SEARCH to all language models
 * - OpenAI/Anthropic/Google add FILE_INPUT to all language models (provider API supports PDF)
 */
function generateCapabilityOverrides(
  model: ModelConfig,
  providerId: string
): ProviderModelOverride['capabilities'] | null {
  if (!isLanguageModel(model)) return null

  const additions: ModelCapability[] = []

  if (
    PROVIDERS_WITH_UNIVERSAL_WEB_SEARCH.has(providerId) &&
    !model.capabilities?.includes(ModelCapability.WEB_SEARCH)
  ) {
    additions.push(ModelCapability.WEB_SEARCH)
  }

  if (PROVIDERS_WITH_FILE_INPUT.has(providerId) && !model.capabilities?.includes(ModelCapability.FILE_INPUT)) {
    additions.push(ModelCapability.FILE_INPUT)
  }

  return additions.length > 0 ? { add: additions } : null
}

/**
 * Create a new ModelConfig from provider data
 */
function createNewModel(providerModel: ProviderModelEntry, providerId: string): ModelConfig {
  // Infer capabilities from model ID patterns
  const inferredCapabilities = inferCapabilitiesFromModelId(providerModel.normalizedId)

  // Also check if provider data indicates reasoning capability
  if (providerModel.hasReasoning && !inferredCapabilities.includes(ModelCapability.REASONING)) {
    inferredCapabilities.push(ModelCapability.REASONING)
  }

  const model: ModelConfig = {
    id: providerModel.normalizedId,
    name: providerModel.name || providerModel.normalizedId,
    ownedBy: inferPublisher(providerModel.normalizedId) || providerId,
    // Set capabilities (empty array if none inferred, not null)
    capabilities: inferredCapabilities.length > 0 ? inferredCapabilities : [],
    metadata: {
      source: providerId,
      originalId: providerModel.originalId
    }
  }

  // Add context window if available
  if (providerModel.contextWindow) {
    model.contextWindow = providerModel.contextWindow
  }

  // Add max output tokens if available
  if (providerModel.maxOutputTokens) {
    model.maxOutputTokens = providerModel.maxOutputTokens
  }

  // Add pricing if available
  if (providerModel.pricing) {
    model.pricing = {
      input: { perMillionTokens: providerModel.pricing.input, currency: providerModel.pricing.currency },
      output: { perMillionTokens: providerModel.pricing.output, currency: providerModel.pricing.currency }
    }
    if (providerModel.pricing.cacheRead) {
      model.pricing.cacheRead = {
        perMillionTokens: providerModel.pricing.cacheRead,
        currency: providerModel.pricing.currency
      }
    }
  }

  return model
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main Generation
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Print configured API keys summary
 */
function printApiKeysSummary(providerIds: string[]): void {
  const configured: string[] = []
  const missing: string[] = []

  for (const providerId of providerIds) {
    if (getApiKey(providerId)) {
      configured.push(providerId)
    } else {
      missing.push(providerId)
    }
  }

  if (configured.length > 0) {
    console.log(`\nAPI keys configured: ${configured.join(', ')}`)
  }
  if (missing.length > 0) {
    console.log(`API keys missing: ${missing.length} providers (will try without auth)`)
    console.log(`  Tip: Set environment variables like OPENAI_API_KEY, DEEPSEEK_API_KEY, etc.`)
  }
}

async function generateProviderModels() {
  console.log('Generating provider-models.json from provider APIs...\n')

  // Read authoritative models.json
  console.log('Reading data files:')
  const modelsPath = path.join(DATA_DIR, 'models.json')
  const providersPath = path.join(DATA_DIR, 'providers.json')

  if (!fs.existsSync(modelsPath)) {
    console.error('Error: models.json not found')
    process.exit(1)
  }
  if (!fs.existsSync(providersPath)) {
    console.error('Error: providers.json not found')
    process.exit(1)
  }

  const modelsData: ModelsDataFile = JSON.parse(fs.readFileSync(modelsPath, 'utf-8'))
  const providersData: ProvidersDataFile = JSON.parse(fs.readFileSync(providersPath, 'utf-8'))

  console.log(`  - models.json: ${modelsData.models.length} models`)
  console.log(`  - providers.json: ${providersData.providers.length} providers`)

  // Build lookup map (normalized ID → canonical model)
  // When multiple models normalize to the same ID, keep the one with the shortest path (most canonical)
  const modelsMap = new Map<string, ModelConfig>()
  for (const model of modelsData.models) {
    const normalizedId = normalizeModelId(model.id)
    const existing = modelsMap.get(normalizedId)
    if (!existing || model.id.split('/').length < existing.id.split('/').length) {
      modelsMap.set(normalizedId, model)
    }
  }

  // Enrich existing models with inferred capabilities they may be missing
  let capabilitiesEnriched = 0
  for (const model of modelsData.models) {
    const inferred = inferCapabilitiesFromModelId(model.id)
    if (inferred.length === 0) continue

    const existing = new Set(model.capabilities || [])
    let added = false
    for (const cap of inferred) {
      if (!existing.has(cap)) {
        existing.add(cap)
        added = true
      }
    }
    if (added) {
      model.capabilities = Array.from(existing)
      capabilitiesEnriched++
    }
  }
  if (capabilitiesEnriched > 0) {
    console.log(`  - Enriched capabilities for ${capabilitiesEnriched} existing models`)
  }

  // Find providers with modelsApiUrls
  const providersWithApi = providersData.providers.filter((p) => p.modelsApiUrls)
  console.log(`\nProviders with modelsApiUrls: ${providersWithApi.length}`)

  if (providersWithApi.length === 0) {
    console.log('No providers with modelsApiUrls configured. Nothing to generate.')
    return
  }

  // Print API keys summary
  printApiKeysSummary(providersWithApi.map((p) => p.id))

  // Fetch from each provider's API
  console.log('\nFetching from provider APIs:')
  const allOverrides: ProviderModelOverride[] = []
  const newModels: ModelConfig[] = []

  // Track totals
  const totals = {
    fetched: 0,
    newModelsAdded: 0,
    overridesGenerated: 0
  }

  for (const provider of providersWithApi) {
    console.log(`\n  ${provider.id}:`)

    const providerModels: ProviderModelEntry[] = []
    const urls = provider.modelsApiUrls!

    // Fetch from all configured URLs in parallel (default, embedding, reranker)
    try {
      const urlEntries = Object.entries(urls).filter(([, url]) => url) as [string, string][]
      console.log(`    - Fetching ${urlEntries.length} URLs in parallel...`)

      const results = await Promise.all(
        urlEntries.map(async ([urlType, url]) => {
          const models = await fetchProviderModels(provider.id, url)
          console.log(`      ✓ ${urlType}: ${models.length} models`)
          return models
        })
      )

      for (const models of results) {
        providerModels.push(...models)
      }
      console.log(`    ✓ Total: ${providerModels.length} models`)
      totals.fetched += providerModels.length
    } catch (error) {
      console.error(`    ✗ Fetch failed:`, error instanceof Error ? error.message : error)
      continue
    }

    // Process each model
    const stats = {
      existing: 0,
      new: 0,
      overridesGenerated: 0
    }

    for (const providerModel of providerModels) {
      // Check if model exists in models.json
      const existingModel = modelsMap.get(providerModel.normalizedId) || null

      if (!existingModel) {
        // NEW MODEL: Add to models.json
        const newModel = createNewModel(providerModel, provider.id)
        newModels.push(newModel)
        // Update map for subsequent providers
        modelsMap.set(providerModel.normalizedId, newModel)
        stats.new++

        // Always create provider-models entry so UI knows which providers offer the model
        const entry: ProviderModelOverride = {
          providerId: provider.id,
          modelId: newModel.id,
          priority: 0
        }

        // Record original API model ID if different from normalized ID
        if (providerModel.originalId !== newModel.id) {
          entry.apiModelId = providerModel.originalId
        }

        // Record variant: combine parameterSize and variant if both exist
        const modelVariant = combineVariants(providerModel.parameterSize, providerModel.variant)
        if (modelVariant) {
          entry.modelVariant = modelVariant
        }

        // Generate reasoning override for new models too
        const reasoningConfig = generateReasoningConfig(newModel, providerModel.hasReasoning ?? false, provider.id)
        if (reasoningConfig) {
          entry.reasoning = reasoningConfig
        }

        // Generate capability overrides (e.g., OpenRouter adds WEB_SEARCH to all language models)
        const capOverrides = generateCapabilityOverrides(newModel, provider.id)
        if (capOverrides) {
          entry.capabilities = capOverrides
        }

        // Write endpointTypes only when different from provider default
        const endpointTypesOverride = generateEndpointTypesOverride(providerModel, provider)
        if (endpointTypesOverride) {
          entry.endpointTypes = endpointTypesOverride
        }

        // Write modalities if available from parser
        if (providerModel.inputModalities?.length) {
          entry.inputModalities = providerModel.inputModalities as Modality[]
        }
        if (providerModel.outputModalities?.length) {
          entry.outputModalities = providerModel.outputModalities as Modality[]
        }

        allOverrides.push(entry)
        stats.overridesGenerated++
      } else {
        // EXISTING MODEL: Always generate an entry to record provider offers this model
        stats.existing++

        // Compare and build override entry
        const pricingDiff = comparePricing(existingModel.pricing, providerModel.pricing)
        const limitsDiff = compareLimits(existingModel, providerModel)
        const reasoningConfig = generateReasoningConfig(existingModel, providerModel.hasReasoning ?? false, provider.id)

        // Check if apiModelId differs from canonical modelId
        const needsApiModelId = providerModel.originalId !== existingModel.id

        // Always create entry - even with no diff, we need to record that this provider offers this model
        const entry: ProviderModelOverride = {
          providerId: provider.id,
          modelId: existingModel.id, // Canonical ID
          priority: 0
        }

        // Record original API model ID if different from canonical
        if (needsApiModelId) {
          entry.apiModelId = providerModel.originalId
        }

        // Record variant: combine parameterSize and variant if both exist
        const modelVariant = combineVariants(providerModel.parameterSize, providerModel.variant)
        if (modelVariant) {
          entry.modelVariant = modelVariant
        }
        if (pricingDiff) {
          entry.pricing = pricingDiff
        }
        if (limitsDiff) {
          entry.limits = limitsDiff
        }
        if (reasoningConfig) {
          entry.reasoning = reasoningConfig
        }

        // Generate capability overrides (e.g., OpenRouter adds WEB_SEARCH to all language models)
        const capOverrides = generateCapabilityOverrides(existingModel, provider.id)
        if (capOverrides) {
          entry.capabilities = capOverrides
        }

        // Write endpointTypes only when different from provider default
        const endpointTypesOverride = generateEndpointTypesOverride(providerModel, provider)
        if (endpointTypesOverride) {
          entry.endpointTypes = endpointTypesOverride
        }

        // Write modalities if available from parser
        if (providerModel.inputModalities?.length) {
          entry.inputModalities = providerModel.inputModalities as Modality[]
        }
        if (providerModel.outputModalities?.length) {
          entry.outputModalities = providerModel.outputModalities as Modality[]
        }

        allOverrides.push(entry)
        stats.overridesGenerated++
      }
    }

    console.log(`    existing: ${stats.existing}, new: ${stats.new}, overrides: ${stats.overridesGenerated}`)
    totals.newModelsAdded += stats.new
    totals.overridesGenerated += stats.overridesGenerated
  }

  // Load existing manual overrides (priority >= 100) to preserve them
  const existingPath = path.join(DATA_DIR, 'provider-models.json')
  let existingManualOverrides: ProviderModelOverride[] = []

  if (fs.existsSync(existingPath)) {
    try {
      const existingData = JSON.parse(fs.readFileSync(existingPath, 'utf-8'))
      existingManualOverrides = (existingData.overrides || []).filter(
        (o: ProviderModelOverride) => (o.priority ?? 0) >= 100
      )
      if (existingManualOverrides.length > 0) {
        console.log(`\nPreserving ${existingManualOverrides.length} manual overrides (priority >= 100)`)
      }
    } catch {
      // Ignore
    }
  }

  // Merge: manual overrides take precedence
  const manualKeys = new Set(
    existingManualOverrides.map((o) => `${o.providerId}::${o.modelId}::${o.modelVariant || ''}`)
  )

  const filteredAutoOverrides = allOverrides.filter(
    (o) => !manualKeys.has(`${o.providerId}::${o.modelId}::${o.modelVariant || ''}`)
  )

  const finalOverrides = [...existingManualOverrides, ...filteredAutoOverrides]

  // Sort by providerId, then modelId, then variant
  finalOverrides.sort((a, b) => {
    const providerCompare = a.providerId.localeCompare(b.providerId)
    if (providerCompare !== 0) return providerCompare
    const modelCompare = a.modelId.localeCompare(b.modelId)
    if (modelCompare !== 0) return modelCompare
    return (a.modelVariant || '').localeCompare(b.modelVariant || '')
  })

  // Add new models to models.json
  if (newModels.length > 0) {
    console.log(`\nAdding ${newModels.length} new models to models.json...`)
    modelsData.models.push(...newModels)
    modelsData.version = new Date().toISOString().split('T')[0].replace(/-/g, '.')
    fs.writeFileSync(modelsPath, JSON.stringify(modelsData, null, 2) + '\n', 'utf-8')
    console.log(`  ✓ Updated models.json (${modelsData.models.length} total models)`)
  }

  // Write provider-models.json
  const output = {
    version: new Date().toISOString().split('T')[0].replace(/-/g, '.'),
    overrides: finalOverrides
  }

  const outputPath = path.join(DATA_DIR, 'provider-models.json')
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n', 'utf-8')

  // Summary
  console.log('\n' + '='.repeat(60))
  console.log('Summary')
  console.log('='.repeat(60))
  console.log(`  Total models fetched: ${totals.fetched}`)
  console.log(`  New models added to models.json: ${totals.newModelsAdded}`)
  console.log(`  Overrides generated: ${totals.overridesGenerated}`)
  console.log(`  Manual overrides preserved: ${existingManualOverrides.length}`)
  console.log(`\n✓ Generated ${outputPath}`)
  console.log(`  - Total entries: ${finalOverrides.length}`)
}

// Run the script
generateProviderModels().catch(console.error)
