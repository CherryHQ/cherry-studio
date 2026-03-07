/**
 * OpenRouter model importer
 * Fetches and transforms model data from OpenRouter API
 */

import * as fs from 'fs'
import * as path from 'path'

import type { ModelConfig } from '../../../schemas'
import { deduplicateModels, mergeModelsList, MergeStrategies } from '../../merge-utils'
import { OpenRouterTransformer } from './transformer'
import { type OpenRouterResponse, OpenRouterResponseSchema } from './types'

export class OpenRouterImporter {
  private transformer: OpenRouterTransformer
  private apiUrl: string

  constructor(apiUrl: string = 'https://openrouter.ai/api/v1') {
    this.apiUrl = apiUrl
    this.transformer = new OpenRouterTransformer()
  }

  /**
   * Import models from OpenRouter API
   * @param outputPath - Optional path to save the raw data
   * @returns Array of transformed ModelConfig objects
   */
  async importModels(outputPath?: string): Promise<ModelConfig[]> {
    console.log('Fetching models from OpenRouter API...')

    // Fetch from API
    const response = await fetch(`${this.apiUrl}/models`)
    if (!response.ok) {
      throw new Error(`OpenRouter API error: ${response.status} ${response.statusText}`)
    }

    const rawData = await response.json()

    // Validate response with zod schema
    const parseResult = OpenRouterResponseSchema.safeParse(rawData)
    if (!parseResult.success) {
      console.error('Validation errors:', parseResult.error.issues)
      throw new Error(`Invalid API response: ${parseResult.error.message}`)
    }

    const data: OpenRouterResponse = parseResult.data
    console.log(`✓ Fetched ${data.data.length} models from OpenRouter`)

    // Transform models
    console.log('Transforming models...')
    const models = data.data.map((model) => this.transformer.transform(model))
    console.log(`✓ Transformed ${models.length} models`)

    // Optionally write to file
    if (outputPath) {
      const output = {
        version: new Date().toISOString().split('T')[0].replace(/-/g, '.'),
        models
      }

      fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n', 'utf-8')
      console.log(`✓ Saved to ${outputPath}`)
    }

    return models
  }

  /**
   * Static method to run importer from CLI
   */
  static async run() {
    const importer = new OpenRouterImporter()
    const outputPath = path.join(process.cwd(), 'data', 'openrouter-models.json')
    const mainModelsPath = path.join(process.cwd(), 'data', 'models.json')

    try {
      const models = await importer.importModels(outputPath)

      // Deduplicate models
      const deduplicatedModels = deduplicateModels(models)
      console.log(
        `✓ Deduplicated to ${deduplicatedModels.length} unique models (removed ${models.length - deduplicatedModels.length} duplicates)`
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

      // Clean up temporary file after successful merge
      if (fs.existsSync(outputPath)) {
        fs.unlinkSync(outputPath)
        console.log(`✓ Cleaned up temporary file: ${path.basename(outputPath)}`)
      }

      console.log('\n✓ Import completed successfully')
    } catch (error) {
      console.error('✗ Import failed:', error)
      throw error
    }
  }
}
