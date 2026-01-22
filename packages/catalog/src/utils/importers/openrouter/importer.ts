/**
 * OpenRouter model importer
 * Fetches and transforms model data from OpenRouter API
 */

import * as fs from 'fs'
import * as path from 'path'

import type { ModelConfig } from '../../../schemas'
import { OpenRouterTransformer } from './transformer'
import type { OpenRouterResponse } from './types'

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

    const data: OpenRouterResponse = await response.json()
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

    try {
      await importer.importModels(outputPath)
      console.log('✓ Import complete')
      process.exit(0)
    } catch (error) {
      console.error('✗ Import failed:', error)
      process.exit(1)
    }
  }
}
