/**
 * AIHubMix one-time importer
 * Fetches models from AIHubMix API and saves to JSON file
 */

import * as fs from 'fs/promises'
import * as path from 'path'

import { AiHubMixTransformer } from './transformer'
import type { AiHubMixResponse } from './types'

export class AiHubMixImporter {
  private transformer: AiHubMixTransformer
  private apiUrl: string

  constructor(apiUrl = 'https://aihubmix.com/api/v1') {
    this.transformer = new AiHubMixTransformer()
    this.apiUrl = apiUrl
  }

  /**
   * Fetch models from AIHubMix API and save to JSON file
   * @param outputPath - Path to output JSON file
   */
  async importModels(outputPath: string): Promise<void> {
    console.log('Fetching models from AIHubMix API...')
    console.log(`API URL: ${this.apiUrl}/models`)

    const response = await fetch(`${this.apiUrl}/models`)
    if (!response.ok) {
      throw new Error(`AIHubMix API error: ${response.status} ${response.statusText}`)
    }

    const json: AiHubMixResponse = await response.json()
    console.log(`✓ Fetched ${json.data.length} models from AIHubMix`)

    // Transform to internal format
    console.log('Transforming models to internal format...')
    const models = json.data.map((m) => this.transformer.transform(m))
    console.log(`✓ Transformed ${models.length} models`)

    // Prepare output matching ModelListSchema format
    const output = {
      version: new Date().toISOString().split('T')[0].replace(/-/g, '.'),
      models
    }

    // Ensure output directory exists
    const outputDir = path.dirname(outputPath)
    await fs.mkdir(outputDir, { recursive: true })

    // Write to file
    await fs.writeFile(outputPath, JSON.stringify(output, null, 2) + '\n', 'utf-8')
    console.log(`✓ Saved ${models.length} models to ${outputPath}`)
  }

  /**
   * CLI entry point
   */
  static async run(): Promise<void> {
    const importer = new AiHubMixImporter()
    const outputPath = path.join(process.cwd(), 'data', 'aihubmix-models.json')

    try {
      await importer.importModels(outputPath)
      console.log('\n✓ Import completed successfully')
    } catch (error) {
      console.error('\n✗ Import failed:', error)
      throw error
    }
  }
}
