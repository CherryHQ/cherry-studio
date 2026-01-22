#!/usr/bin/env tsx

import * as fs from 'fs'
import * as path from 'path'
import { OpenRouterTransformer } from '../src/utils/importers/openrouter/transformer'
import { mergeModelsList, MergeStrategies } from '../src/utils/merge-utils'
import type { OpenRouterResponse } from '../src/utils/importers/openrouter/types'

async function importOpenRouterModels() {
  console.log('Fetching models from OpenRouter API...')
  const modelsApiUrl = 'https://openrouter.ai/api/v1/models'
  const embeddingsApiUrl = 'https://openrouter.ai/api/v1/embeddings/models'

  try {
    // Fetch from both APIs in parallel
    console.log('  - Fetching chat models...')
    const [modelsResponse, embeddingsResponse] = await Promise.all([
      fetch(modelsApiUrl),
      fetch(embeddingsApiUrl)
    ])

    if (!modelsResponse.ok) {
      throw new Error(`Models API error: ${modelsResponse.status} ${modelsResponse.statusText}`)
    }
    if (!embeddingsResponse.ok) {
      throw new Error(`Embeddings API error: ${embeddingsResponse.status} ${embeddingsResponse.statusText}`)
    }

    const modelsJson: OpenRouterResponse = await modelsResponse.json()
    const embeddingsJson: OpenRouterResponse = await embeddingsResponse.json()

    console.log(`✓ Fetched ${modelsJson.data.length} chat models from OpenRouter`)
    console.log(`✓ Fetched ${embeddingsJson.data.length} embedding models from OpenRouter`)

    // Combine both arrays
    const json: OpenRouterResponse = {
      data: [...modelsJson.data, ...embeddingsJson.data]
    }
    console.log(`✓ Total: ${json.data.length} models from OpenRouter`)

    // Transform models
    console.log('Transforming models...')
    const transformer = new OpenRouterTransformer()
    const models = json.data.map((m) => transformer.transform(m))
    console.log(`✓ Transformed ${models.length} models`)

    // Optional: Save raw OpenRouter data for review
    const openrouterOutputPath = path.join(__dirname, '../data/openrouter-models.json')
    const openrouterOutput = {
      version: new Date().toISOString().split('T')[0].replace(/-/g, '.'),
      models
    }
    fs.writeFileSync(openrouterOutputPath, JSON.stringify(openrouterOutput, null, 2) + '\n', 'utf-8')
    console.log(`✓ Saved OpenRouter models to ${openrouterOutputPath}`)

    // Load existing models.json
    const mainModelsPath = path.join(__dirname, '../data/models.json')
    const mainModelsData = JSON.parse(fs.readFileSync(mainModelsPath, 'utf-8'))

    // Smart merge - only fill undefined values
    console.log('Merging with existing models (preserving non-undefined values)...')
    const mergedModels = mergeModelsList(
      mainModelsData.models || [],
      models,
      MergeStrategies.FILL_UNDEFINED
    )

    // Save
    mainModelsData.models = mergedModels
    fs.writeFileSync(mainModelsPath, JSON.stringify(mainModelsData, null, 2) + '\n', 'utf-8')

    console.log(`✓ Merged models.json: ${mergedModels.length} total models`)
    console.log(`  - Preserved existing non-undefined values`)
    console.log(`  - Filled in undefined values from OpenRouter`)
    console.log(`\n✓ Import complete!`)

  } catch (error) {
    console.error('✗ Failed to import OpenRouter models:', error)
    process.exit(1)
  }
}

// Run the script
importOpenRouterModels().catch(console.error)
