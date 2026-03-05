#!/usr/bin/env tsx

/**
 * Import providers and models from models.dev API
 * https://models.dev/api.json
 */

import * as fs from 'fs'
import * as path from 'path'

import { ModelsDevTransformer } from '../src/utils/importers/modelsdev/transformer'
import { type ModelsDevResponse, ModelsDevResponseSchema } from '../src/utils/importers/modelsdev/types'
import { deduplicateModels, mergeModelsList, MergeStrategies } from '../src/utils/merge-utils'

const API_URL = 'https://models.dev/api.json'

async function importModelsDevData() {
  console.log('Fetching data from models.dev API...')
  console.log(`  URL: ${API_URL}`)

  try {
    const response = await fetch(API_URL)
    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`)
    }

    const rawData = await response.json()

    // Validate with zod schema
    console.log('Validating API response...')
    const parseResult = ModelsDevResponseSchema.safeParse(rawData)
    if (!parseResult.success) {
      console.error('Validation errors:', JSON.stringify(parseResult.error.issues, null, 2))
      throw new Error(`Invalid API response: ${parseResult.error.message}`)
    }

    const data: ModelsDevResponse = parseResult.data
    const providerIds = Object.keys(data)
    console.log(`✓ Fetched ${providerIds.length} providers from models.dev`)

    // Transform data
    console.log('Transforming providers and models...')
    const transformer = new ModelsDevTransformer()

    const providers: ReturnType<typeof transformer.transformProvider>[] = []
    const models: ReturnType<typeof transformer.transformModel>[] = []
    const modelsByProvider: Record<string, typeof models> = {}

    for (const providerId of providerIds) {
      const apiProvider = data[providerId]
      const modelIds = Object.keys(apiProvider.models)

      // Transform provider
      const provider = transformer.transformProvider(apiProvider)
      providers.push(provider)

      // Transform models for this provider
      const providerModels: typeof models = []
      for (const modelId of modelIds) {
        const apiModel = apiProvider.models[modelId]
        const model = transformer.transformModel(apiModel, providerId)
        models.push(model)
        providerModels.push(model)
      }
      modelsByProvider[providerId] = providerModels
    }

    console.log(`✓ Transformed ${providers.length} providers and ${models.length} models (raw)`)

    // Deduplicate models (same model ID from different aggregators)
    const deduplicatedModels = deduplicateModels(models)
    console.log(
      `✓ Deduplicated to ${deduplicatedModels.length} unique models (removed ${models.length - deduplicatedModels.length} duplicates)`
    )

    // Generate version string
    const version = new Date().toISOString().split('T')[0].replace(/-/g, '.')

    // Save modelsdev-specific files
    const dataDir = path.join(__dirname, '../data')

    // Save providers
    const providersPath = path.join(dataDir, 'modelsdev-providers.json')
    fs.writeFileSync(providersPath, JSON.stringify({ version, providers }, null, 2) + '\n', 'utf-8')
    console.log(`✓ Saved ${providers.length} providers to ${providersPath}`)

    // Save models (modelsdev-specific, deduplicated)
    const modelsdevModelsPath = path.join(dataDir, 'modelsdev-models.json')
    fs.writeFileSync(
      modelsdevModelsPath,
      JSON.stringify({ version, models: deduplicatedModels }, null, 2) + '\n',
      'utf-8'
    )
    console.log(`✓ Saved ${deduplicatedModels.length} unique models to ${modelsdevModelsPath}`)

    // Merge with main models.json (create if not exists)
    const mainModelsPath = path.join(dataDir, 'models.json')
    if (fs.existsSync(mainModelsPath)) {
      console.log('\nMerging with existing models.json...')
      const mainModelsData = JSON.parse(fs.readFileSync(mainModelsPath, 'utf-8'))

      // Deduplicate existing models first (in case of legacy duplicates)
      const existingDeduped = deduplicateModels(mainModelsData.models || [])

      // Smart merge - fill undefined values but always update ownedBy field
      const mergedModels = mergeModelsList(existingDeduped, deduplicatedModels, {
        ...MergeStrategies.FILL_UNDEFINED,
        alwaysOverwrite: ['ownedBy'] // Always update ownedBy with correct value
      })

      mainModelsData.models = mergedModels
      mainModelsData.version = version
      fs.writeFileSync(mainModelsPath, JSON.stringify(mainModelsData, null, 2) + '\n', 'utf-8')

      console.log(`✓ Merged models.json: ${mergedModels.length} total models`)
      console.log(`  - Preserved existing non-undefined values`)
      console.log(`  - Filled in undefined values from models.dev`)
    } else {
      console.log('\nCreating models.json...')
      const mainModelsData = { version, models: deduplicatedModels }
      fs.writeFileSync(mainModelsPath, JSON.stringify(mainModelsData, null, 2) + '\n', 'utf-8')
      console.log(`✓ Created models.json with ${deduplicatedModels.length} unique models`)
    }

    // Print summary by provider
    console.log('\n--- Summary by Provider ---')
    for (const providerId of providerIds.slice(0, 10)) {
      const count = modelsByProvider[providerId]?.length || 0
      console.log(`  ${providerId}: ${count} models`)
    }
    if (providerIds.length > 10) {
      console.log(`  ... and ${providerIds.length - 10} more providers`)
    }

    console.log(`\n✓ Import complete!`)
    console.log(`  Total providers: ${providers.length}`)
    console.log(`  Total models (raw): ${models.length}`)
    console.log(`  Unique models: ${deduplicatedModels.length}`)
  } catch (error) {
    console.error('✗ Failed to import from models.dev:', error)
    process.exit(1)
  }
}

// Run the script
importModelsDevData().catch(console.error)
