#!/usr/bin/env tsx

/**
 * Batch sync all provider models
 * Fetches models from all providers with models_api configured (except OpenRouter and AIHubMix)
 * OpenRouter and AIHubMix should be synced manually using import scripts as they are authoritative sources
 */

import { config } from 'dotenv'
import fs from 'fs/promises'
import path from 'path'

import type { ModelConfig,ModelsDataFile, OverridesDataFile, ProvidersDataFile } from '../src/schemas'
import { BaseImporter } from '../src/utils/importers/base/base-importer'
import { OpenAICompatibleTransformer } from '../src/utils/importers/base/base-transformer'
import { deduplicateOverrides,generateOverride, mergeOverrides } from '../src/utils/override-utils'

// Load environment variables
config({ path: path.join(__dirname, '../.env') })

const DATA_DIR = path.join(__dirname, '../data')

// Providers to skip (authoritative sources handled separately)
const SKIP_PROVIDERS = new Set(['openrouter', 'aihubmix'])

// Map provider IDs to environment variable names
const PROVIDER_ENV_MAP: Record<string, string> = {
  cherryin: 'CHERRYIN_API_KEY',
  silicon: 'SILICON_API_KEY',
  ocoolai: 'OCOOLAI_API_KEY',
  zhipu: 'ZHIPU_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  alayanew: 'ALAYANEW_API_KEY',
  dmxapi: 'DMXAPI_API_KEY',
  aionly: 'AIONLY_API_KEY',
  burncloud: 'BURNCLOUD_API_KEY',
  tokenflux: 'TOKENFLUX_API_KEY',
  '302ai': 'AI_302_API_KEY',
  cephalon: 'CEPHALON_API_KEY',
  lanyun: 'LANYUN_API_KEY',
  ph8: 'PH8_API_KEY',
  sophnet: 'SOPHNET_API_KEY',
  ppio: 'PPIO_API_KEY',
  qiniu: 'QINIU_API_KEY',
  openai: 'OPENAI_API_KEY',
  github: 'GITHUB_API_KEY',
  copilot: 'COPILOT_API_KEY',
  yi: 'YI_API_KEY',
  moonshot: 'MOONSHOT_API_KEY',
  baichuan: 'BAICHUAN_API_KEY',
  dashscope: 'DASHSCOPE_API_KEY',
  stepfun: 'STEPFUN_API_KEY',
  doubao: 'DOUBAO_API_KEY',
  infini: 'INFINI_API_KEY',
  minimax: 'MINIMAX_API_KEY',
  groq: 'GROQ_API_KEY',
  together: 'TOGETHER_API_KEY',
  fireworks: 'FIREWORKS_API_KEY',
  nvidia: 'NVIDIA_API_KEY',
  grok: 'GROK_API_KEY',
  hyperbolic: 'HYPERBOLIC_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  jina: 'JINA_API_KEY',
  perplexity: 'PERPLEXITY_API_KEY',
  modelscope: 'MODELSCOPE_API_KEY',
  xirang: 'XIRANG_API_KEY',
  hunyuan: 'HUNYUAN_API_KEY',
  'tencent-cloud-ti': 'TENCENT_CLOUD_TI_API_KEY',
  'baidu-cloud': 'BAIDU_CLOUD_API_KEY',
  voyageai: 'VOYAGEAI_API_KEY',
  poe: 'POE_API_KEY',
  longcat: 'LONGCAT_API_KEY',
  huggingface: 'HUGGINGFACE_API_KEY',
  cerebras: 'CEREBRAS_API_KEY'
}

/**
 * Get API key for a provider from environment variables
 */
function getApiKey(providerId: string): string | undefined {
  const envVarName = PROVIDER_ENV_MAP[providerId]
  if (!envVarName) return undefined

  return process.env[envVarName]
}

interface SyncResult {
  providerId: string
  status: 'success' | 'skipped' | 'error'
  fetched?: number
  newModels?: number
  overridesGenerated?: number
  overridesMerged?: number
  error?: string
}

/**
 * Sync models from a single provider
 */
async function syncProvider(
  providerId: string,
  provider: any,
  baseModels: ModelConfig[],
  existingOverrides: any[]
): Promise<SyncResult> {
  try {
    console.log(`\n[${providerId}] Syncing models...`)

    // Get API key from environment
    const apiKey = getApiKey(providerId)
    if (!apiKey) {
      console.warn(`  ⚠ No API key found for ${providerId} (env: ${PROVIDER_ENV_MAP[providerId]})`)
      console.warn(`    Set ${PROVIDER_ENV_MAP[providerId]} in .env file`)
    }

    // Initialize importer with default OpenAI-compatible transformer
    const importer = new BaseImporter()
    const transformer = new OpenAICompatibleTransformer()

    // Fetch from all endpoints
    const allProviderModels: ModelConfig[] = []

    for (const endpoint of provider.models_api.endpoints) {
      try {
        console.log(`  - Fetching from ${endpoint.url}`)
        const result = await importer.importFromEndpoint(providerId, endpoint, transformer, apiKey)
        allProviderModels.push(...result.models)
        console.log(`    ✓ Fetched ${result.models.length} models`)
      } catch (error) {
        console.error(`    ✗ Failed to fetch from ${endpoint.url}:`, error instanceof Error ? error.message : error)
      }
    }

    if (allProviderModels.length === 0) {
      return {
        providerId,
        status: 'error',
        error: 'No models fetched from any endpoint'
      }
    }

    // Statistics
    const stats = {
      fetched: allProviderModels.length,
      newModels: 0,
      overridesGenerated: 0,
      overridesMerged: 0
    }

    // Check for new models (not in base models.json)
    const baseModelIds = new Set(baseModels.map((m) => m.id.toLowerCase()))
    const newModels = allProviderModels.filter((m) => !baseModelIds.has(m.id.toLowerCase()))
    stats.newModels = newModels.length

    if (newModels.length > 0) {
      console.log(`  + Adding ${newModels.length} new models to models.json`)
      baseModels.push(...newModels)
    }

    // Generate or update overrides for existing models
    const newOverrides = []
    for (const providerModel of allProviderModels) {
      const baseModel = baseModels.find((m) => m.id.toLowerCase() === providerModel.id.toLowerCase())
      if (!baseModel) continue // Skip new models (already added)

      // Always generate override to mark provider support (even if identical)
      const generatedOverride = generateOverride(baseModel, providerModel, providerId, {
        priority: 0,
        alwaysCreate: true // Always create override to mark provider support
      })

      if (generatedOverride) {
        // Check if manual override exists (priority >= 100)
        const existingOverride = existingOverrides.find(
          (o: any) => o.provider_id === providerId && o.model_id.toLowerCase() === providerModel.id.toLowerCase()
        )

        if (existingOverride) {
          // Merge with existing override (preserve manual edits)
          const mergedOverride = mergeOverrides(existingOverride, generatedOverride, {
            preserveManual: true,
            manualPriorityThreshold: 100
          })
          newOverrides.push(mergedOverride)
          stats.overridesMerged++
        } else {
          // Add new override
          newOverrides.push(generatedOverride)
          stats.overridesGenerated++
        }
      }
    }

    // Update existingOverrides array
    if (newOverrides.length > 0) {
      // Remove old auto-generated overrides for this provider (priority < 100)
      const filteredOverrides = existingOverrides.filter(
        (o: any) => !(o.provider_id === providerId && o.priority < 100)
      )

      // Add new overrides
      existingOverrides.length = 0
      existingOverrides.push(...filteredOverrides, ...newOverrides)

      console.log(`  + Generated ${stats.overridesGenerated} new overrides, merged ${stats.overridesMerged} existing`)
    }

    return {
      providerId,
      status: 'success',
      ...stats
    }
  } catch (error) {
    console.error(`[${providerId}] Error:`, error instanceof Error ? error.message : error)
    return {
      providerId,
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Main sync function
 */
async function syncAllProviders() {
  console.log('='.repeat(60))
  console.log('Batch Provider Model Sync')
  console.log('='.repeat(60))
  console.log('\nLoading data files...\n')

  try {
    // Load providers
    const providersPath = path.join(DATA_DIR, 'providers.json')
    const providersData: ProvidersDataFile = JSON.parse(await fs.readFile(providersPath, 'utf-8'))

    // Load models
    const modelsPath = path.join(DATA_DIR, 'models.json')
    const modelsData: ModelsDataFile = JSON.parse(await fs.readFile(modelsPath, 'utf-8'))

    // Load overrides
    const overridesPath = path.join(DATA_DIR, 'overrides.json')
    let overridesData: OverridesDataFile
    try {
      overridesData = JSON.parse(await fs.readFile(overridesPath, 'utf-8'))
    } catch {
      overridesData = {
        version: new Date().toISOString().split('T')[0].replace(/-/g, '.'),
        overrides: []
      }
    }

    console.log(`Loaded:`)
    console.log(`  - ${providersData.providers.length} providers`)
    console.log(`  - ${modelsData.models.length} models`)
    console.log(`  - ${overridesData.overrides.length} overrides`)

    // Filter providers with models_api enabled (excluding skip list)
    const providersToSync = providersData.providers.filter(
      (p) => p.models_api && p.models_api.enabled && !SKIP_PROVIDERS.has(p.id)
    )

    console.log(`\nProviders to sync: ${providersToSync.length}`)
    console.log(
      `Skipping: ${Array.from(SKIP_PROVIDERS).join(', ')} (authoritative sources, use import scripts instead)\n`
    )

    if (providersToSync.length === 0) {
      console.log('No providers to sync.')
      return
    }

    // Check API keys availability
    const providersWithKeys = providersToSync.filter((p) => getApiKey(p.id))
    const providersWithoutKeys = providersToSync.filter((p) => !getApiKey(p.id))

    console.log(`API Keys Status:`)
    console.log(`  ✓ Found: ${providersWithKeys.length}`)
    console.log(`  ✗ Missing: ${providersWithoutKeys.length}`)

    if (providersWithoutKeys.length > 0) {
      console.log(`\nProviders without API keys (will likely fail):`)
      providersWithoutKeys.forEach((p) => {
        console.log(`  - ${p.id.padEnd(20)} (env: ${PROVIDER_ENV_MAP[p.id]})`)
      })
      console.log(`\nTo configure API keys:`)
      console.log(`  1. Copy .env.example to .env`)
      console.log(`  2. Fill in your API keys`)
      console.log(`  3. Re-run this script\n`)
    }

    // Sync each provider
    const results: SyncResult[] = []

    for (const provider of providersToSync) {
      const result = await syncProvider(provider.id, provider, modelsData.models, overridesData.overrides)
      results.push(result)

      // Update last_synced timestamp
      if (result.status === 'success' && provider.models_api) {
        provider.models_api.last_synced = new Date().toISOString()
      }

      // Small delay to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }

    // Deduplicate overrides
    console.log('\nDeduplicating overrides...')
    const beforeCount = overridesData.overrides.length
    overridesData.overrides = deduplicateOverrides(overridesData.overrides)
    const afterCount = overridesData.overrides.length
    if (beforeCount !== afterCount) {
      console.log(`  Removed ${beforeCount - afterCount} duplicate overrides`)
    }

    // Save all data files
    console.log('\nSaving data files...')
    await fs.writeFile(providersPath, JSON.stringify(providersData, null, 2) + '\n', 'utf-8')
    await fs.writeFile(modelsPath, JSON.stringify(modelsData, null, 2) + '\n', 'utf-8')
    await fs.writeFile(overridesPath, JSON.stringify(overridesData, null, 2) + '\n', 'utf-8')

    // Print summary
    console.log('\n' + '='.repeat(60))
    console.log('Sync Summary')
    console.log('='.repeat(60))

    const successful = results.filter((r) => r.status === 'success')
    const failed = results.filter((r) => r.status === 'error')

    console.log(`\nTotal providers: ${results.length}`)
    console.log(`  ✓ Successful: ${successful.length}`)
    console.log(`  ✗ Failed: ${failed.length}`)

    if (successful.length > 0) {
      const totalFetched = successful.reduce((sum, r) => sum + (r.fetched || 0), 0)
      const totalNew = successful.reduce((sum, r) => sum + (r.newModels || 0), 0)
      const totalOverrides = successful.reduce((sum, r) => sum + (r.overridesGenerated || 0), 0)
      const totalMerged = successful.reduce((sum, r) => sum + (r.overridesMerged || 0), 0)

      console.log(`\nStatistics:`)
      console.log(`  - Total models fetched: ${totalFetched}`)
      console.log(`  - New models added: ${totalNew}`)
      console.log(`  - Overrides generated: ${totalOverrides}`)
      console.log(`  - Overrides merged: ${totalMerged}`)
    }

    if (failed.length > 0) {
      console.log(`\nFailed providers:`)
      failed.forEach((r) => {
        console.log(`  ✗ ${r.providerId}: ${r.error}`)
      })
    }

    console.log('\n' + '='.repeat(60))
    console.log('✓ Batch sync completed')
    console.log('='.repeat(60))
  } catch (error) {
    console.error('\n✗ Fatal error:', error)
    throw error
  }
}

// Run the sync
syncAllProviders().catch((error) => {
  console.error('Script failed:', error)
  process.exit(1)
})
