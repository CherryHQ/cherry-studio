#!/usr/bin/env tsx

import * as fs from 'fs'
import * as path from 'path'

// Types based on AIHubMix API structure
interface AiHubMixModel {
  model_id: string
  desc: string
  pricing: {
    cache_read?: number
    cache_write?: number
    input: number
    output: number
  }
  types: string
  features: string
  input_modalities: string
  max_output: number
  context_length: number
}

interface AiHubMixResponse {
  data: AiHubMixModel[]
}

// Transformer function (simplified version of the transformer class)
function transformModel(apiModel: AiHubMixModel) {
  const capabilities = mapCapabilities(apiModel.types, apiModel.features)
  const inputModalities = mapModalities(apiModel.input_modalities)
  const outputModalities = inferOutputModalities(apiModel.types)
  const tags = extractTags(apiModel)
  const category = inferCategory(apiModel.types)

  const transformed: any = {
    id: apiModel.model_id,
    description: apiModel.desc || undefined,

    capabilities: capabilities.length > 0 ? capabilities : undefined,
    input_modalities: inputModalities.length > 0 ? inputModalities : undefined,
    output_modalities: outputModalities.length > 0 ? outputModalities : undefined,

    context_window: apiModel.context_length || undefined,
    max_output_tokens: apiModel.max_output || undefined,

    pricing: {
      input: {
        per_million_tokens: apiModel.pricing.input,
        currency: 'USD'
      },
      output: {
        per_million_tokens: apiModel.pricing.output,
        currency: 'USD'
      }
    },

    metadata: {
      source: 'aihubmix',
      tags: tags.length > 0 ? tags : undefined,
      category: category || undefined,
      original_types: apiModel.types || undefined,
      original_features: apiModel.features || undefined
    }
  }

  // Add optional pricing fields only if they exist
  if (apiModel.pricing.cache_read !== undefined) {
    transformed.pricing.cache_read = {
      per_million_tokens: apiModel.pricing.cache_read,
      currency: 'USD'
    }
  }
  if (apiModel.pricing.cache_write !== undefined) {
    transformed.pricing.cache_write = {
      per_million_tokens: apiModel.pricing.cache_write,
      currency: 'USD'
    }
  }

  // Remove undefined description
  if (!apiModel.desc) {
    delete transformed.description
  }

  return transformed
}

function mapCapabilities(types: string, features: string): string[] {
  const caps = new Set<string>()

  if (features) {
    const featureList = features
      .split(',')
      .map((f) => f.trim().toLowerCase())
      .filter(Boolean)

    featureList.forEach((feature) => {
      switch (feature) {
        case 'thinking':
          caps.add('REASONING')
          break
        case 'function_calling':
        case 'tools':
          caps.add('FUNCTION_CALL')
          break
        case 'structured_outputs':
          caps.add('STRUCTURED_OUTPUT')
          break
        case 'web':
        case 'deepsearch':
          caps.add('WEB_SEARCH')
          break
      }
    })
  }

  if (types) {
    const typeList = types
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean)

    typeList.forEach((type) => {
      switch (type) {
        case 'image_generation':
          caps.add('IMAGE_GENERATION')
          break
        case 'video':
          caps.add('VIDEO_GENERATION')
          break
      }
    })
  }

  return Array.from(caps)
}

function mapModalities(modalitiesCSV: string): string[] {
  if (!modalitiesCSV) {
    return []
  }

  const modalities = new Set<string>()

  const modalityList = modalitiesCSV
    .split(',')
    .map((m) => m.trim().toUpperCase())
    .filter(Boolean)

  modalityList.forEach((m) => {
    switch (m) {
      case 'TEXT':
        modalities.add('TEXT')
        break
      case 'IMAGE':
        modalities.add('VISION')
        break
      case 'AUDIO':
        modalities.add('AUDIO')
        break
      case 'VIDEO':
        modalities.add('VIDEO')
        break
    }
  })

  return Array.from(modalities)
}

function inferOutputModalities(types: string): string[] {
  if (!types) {
    return []
  }

  const typeList = types
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)

  if (typeList.includes('image_generation')) {
    return ['VISION']
  }
  if (typeList.includes('video')) {
    return ['VIDEO']
  }

  return []
}

function extractTags(apiModel: AiHubMixModel): string[] {
  const tags: string[] = []

  if (apiModel.types) {
    const types = apiModel.types.split(',').map((t) => t.trim()).filter(Boolean)
    tags.push(...types)
  }

  if (apiModel.features) {
    const features = apiModel.features.split(',').map((f) => f.trim()).filter(Boolean)
    tags.push(...features)
  }

  return Array.from(new Set(tags))
}

function inferCategory(types: string): string {
  if (!types) {
    return ''
  }

  const typeList = types
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)

  if (typeList.includes('image_generation')) {
    return 'image-generation'
  }
  if (typeList.includes('video')) {
    return 'video-generation'
  }

  return ''
}

// Main function
async function generateAiHubMixModels() {
  console.log('Fetching models from AIHubMix API...')
  const apiUrl = 'https://aihubmix.com/api/v1/models'

  try {
    const response = await fetch(apiUrl)
    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`)
    }

    const json: AiHubMixResponse = await response.json()
    console.log(`✓ Fetched ${json.data.length} models from AIHubMix`)

    // Transform to internal format
    console.log('Transforming models...')
    const models = json.data.map((m) => transformModel(m))
    console.log(`✓ Transformed ${models.length} models`)

    // Prepare output
    const output = {
      version: new Date().toISOString().split('T')[0].replace(/-/g, '.'),
      models
    }

    // Write to aihubmix_models.json
    const outputPath = path.join(__dirname, '../data/aihubmix_models.json')
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n', 'utf-8')

    console.log(`✓ Saved ${models.length} models to ${outputPath}`)

    // Also update the main models.json by replacing the models array
    const mainModelsPath = path.join(__dirname, '../data/models.json')
    const mainModelsData = JSON.parse(fs.readFileSync(mainModelsPath, 'utf-8'))

    mainModelsData.models = output.models
    fs.writeFileSync(mainModelsPath, JSON.stringify(mainModelsData, null, 2) + '\n', 'utf-8')

    console.log(`✓ Updated main models.json with ${models.length} models`)

  } catch (error) {
    console.error('✗ Failed to generate AIHubMix models:', error)
    process.exit(1)
  }
}

// Run the script
generateAiHubMixModels().catch(console.error)