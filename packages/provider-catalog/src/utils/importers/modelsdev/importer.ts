/**
 * models.dev data importer
 * Fetches and transforms provider and model data from models.dev API
 *
 * API: https://models.dev/api.json
 * Source: https://github.com/nicepkg/modelsdev
 */

import * as fs from 'fs'
import * as path from 'path'

import type { ModelConfig, ProviderConfig } from '../../../schemas'
import { deduplicateModels, mergeModelsList, MergeStrategies } from '../../merge-utils'
import { ModelsDevTransformer } from './transformer'
import { type ModelsDevResponse, ModelsDevResponseSchema } from './types'

export interface ModelsDevImportResult {
  providers: ProviderConfig[]
  models: ModelConfig[]
  /** Models grouped by provider ID */
  modelsByProvider: Record<string, ModelConfig[]>
}

export class ModelsDevImporter {
  private transformer: ModelsDevTransformer
  private apiUrl: string

  constructor(apiUrl: string = 'https://models.dev/api.json') {
    this.apiUrl = apiUrl
    this.transformer = new ModelsDevTransformer()
  }

  /**
   * Import providers and models from models.dev API
   * @param outputDir - Optional directory to save the data files
   * @returns Transformed providers and models
   */
  async import(outputDir?: string): Promise<ModelsDevImportResult> {
    console.log('Fetching data from models.dev API...')

    // Fetch from API
    const response = await fetch(this.apiUrl)
    if (!response.ok) {
      throw new Error(`models.dev API error: ${response.status} ${response.statusText}`)
    }

    const rawData = await response.json()

    // Validate response with zod schema
    const parseResult = ModelsDevResponseSchema.safeParse(rawData)
    if (!parseResult.success) {
      console.error('Validation errors:', parseResult.error.issues)
      throw new Error(`Invalid API response: ${parseResult.error.message}`)
    }

    const data: ModelsDevResponse = parseResult.data
    const providerIds = Object.keys(data)
    console.log(`✓ Fetched ${providerIds.length} providers from models.dev`)

    // Transform data
    console.log('Transforming providers and models...')

    const providers: ProviderConfig[] = []
    const models: ModelConfig[] = []
    const modelsByProvider: Record<string, ModelConfig[]> = {}

    for (const providerId of providerIds) {
      const apiProvider = data[providerId]

      // Transform provider
      const provider = this.transformer.transformProvider(apiProvider)
      providers.push(provider)

      // Transform models for this provider
      const providerModels: ModelConfig[] = []
      for (const modelId of Object.keys(apiProvider.models)) {
        const apiModel = apiProvider.models[modelId]
        const model = this.transformer.transformModel(apiModel, providerId)
        models.push(model)
        providerModels.push(model)
      }
      modelsByProvider[providerId] = providerModels
    }

    console.log(`✓ Transformed ${providers.length} providers and ${models.length} models`)

    // Optionally write to files
    if (outputDir) {
      await this.saveResults(outputDir, providers, models, modelsByProvider)
    }

    return { providers, models, modelsByProvider }
  }

  /**
   * Save import results to files
   */
  private async saveResults(
    outputDir: string,
    providers: ProviderConfig[],
    models: ModelConfig[],
    modelsByProvider: Record<string, ModelConfig[]>
  ): Promise<void> {
    const version = new Date().toISOString().split('T')[0].replace(/-/g, '.')

    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true })
    }

    // Save providers
    const providersPath = path.join(outputDir, 'modelsdev-providers.json')
    fs.writeFileSync(providersPath, JSON.stringify({ version, providers }, null, 2) + '\n', 'utf-8')
    console.log(`✓ Saved providers to ${providersPath}`)

    // Save all models
    const modelsPath = path.join(outputDir, 'modelsdev-models.json')
    fs.writeFileSync(modelsPath, JSON.stringify({ version, models }, null, 2) + '\n', 'utf-8')
    console.log(`✓ Saved models to ${modelsPath}`)

    // Save models by provider (for reference)
    const byProviderPath = path.join(outputDir, 'modelsdev-by-provider.json')
    fs.writeFileSync(byProviderPath, JSON.stringify({ version, providers: modelsByProvider }, null, 2) + '\n', 'utf-8')
    console.log(`✓ Saved models-by-provider to ${byProviderPath}`)
  }

  /**
   * Import only specific providers
   * @param providerIds - List of provider IDs to import
   * @param outputDir - Optional directory to save the data files
   */
  async importProviders(providerIds: string[], outputDir?: string): Promise<ModelsDevImportResult> {
    console.log(`Fetching data for providers: ${providerIds.join(', ')}...`)

    const response = await fetch(this.apiUrl)
    if (!response.ok) {
      throw new Error(`models.dev API error: ${response.status} ${response.statusText}`)
    }

    const data: ModelsDevResponse = await response.json()

    const providers: ProviderConfig[] = []
    const models: ModelConfig[] = []
    const modelsByProvider: Record<string, ModelConfig[]> = {}

    for (const providerId of providerIds) {
      const apiProvider = data[providerId]
      if (!apiProvider) {
        console.warn(`⚠ Provider not found: ${providerId}`)
        continue
      }

      const provider = this.transformer.transformProvider(apiProvider)
      providers.push(provider)

      const providerModels: ModelConfig[] = []
      for (const modelId of Object.keys(apiProvider.models)) {
        const apiModel = apiProvider.models[modelId]
        const model = this.transformer.transformModel(apiModel, providerId)
        models.push(model)
        providerModels.push(model)
      }
      modelsByProvider[providerId] = providerModels
    }

    console.log(`✓ Transformed ${providers.length} providers and ${models.length} models`)

    if (outputDir) {
      await this.saveResults(outputDir, providers, models, modelsByProvider)
    }

    return { providers, models, modelsByProvider }
  }

  /**
   * Static method to run importer from CLI
   */
  static async run() {
    const importer = new ModelsDevImporter()
    const outputDir = path.join(process.cwd(), 'data')
    const mainModelsPath = path.join(outputDir, 'models.json')

    try {
      const result = await importer.import(outputDir)

      // Deduplicate models
      const deduplicatedModels = deduplicateModels(result.models)
      console.log(
        `✓ Deduplicated to ${deduplicatedModels.length} unique models (removed ${result.models.length - deduplicatedModels.length} duplicates)`
      )

      // Merge with main models.json
      const version = new Date().toISOString().split('T')[0].replace(/-/g, '.')
      if (fs.existsSync(mainModelsPath)) {
        console.log('\nMerging with existing models.json...')
        const mainModelsData = JSON.parse(fs.readFileSync(mainModelsPath, 'utf-8'))

        // Deduplicate existing models first
        const existingDeduped = deduplicateModels(mainModelsData.models || [])

        // Smart merge - only fill undefined values
        const mergedModels = mergeModelsList(existingDeduped, deduplicatedModels, MergeStrategies.FILL_UNDEFINED)

        mainModelsData.models = mergedModels
        mainModelsData.version = version
        fs.writeFileSync(mainModelsPath, JSON.stringify(mainModelsData, null, 2) + '\n', 'utf-8')

        console.log(`✓ Merged models.json: ${mergedModels.length} total models`)
      } else {
        console.log('\nCreating models.json...')
        const mainModelsData = { version, models: deduplicatedModels }
        fs.writeFileSync(mainModelsPath, JSON.stringify(mainModelsData, null, 2) + '\n', 'utf-8')
        console.log(`✓ Created models.json with ${deduplicatedModels.length} unique models`)
      }

      // Clean up temporary files after successful merge
      const tempFiles = ['modelsdev-models.json', 'modelsdev-providers.json', 'modelsdev-by-provider.json']
      for (const file of tempFiles) {
        const filePath = path.join(outputDir, file)
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath)
          console.log(`✓ Cleaned up temporary file: ${file}`)
        }
      }

      console.log('\n✓ Import completed successfully')
    } catch (error) {
      console.error('✗ Import failed:', error)
      throw error
    }
  }
}
