/**
 * AIHubMix one-time importer
 * Fetches models from AIHubMix API and saves to JSON file
 */

import * as fsSync from 'fs'
import * as fs from 'fs/promises'
import * as path from 'path'

import { deduplicateModels, mergeModelsList, MergeStrategies } from '../../merge-utils'
import { AiHubMixTransformer } from './transformer'
import { type AiHubMixResponse, AiHubMixResponseSchema } from './types'

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
   * @returns Array of transformed models
   */
  async importModels(outputPath: string): Promise<ReturnType<AiHubMixTransformer['transform']>[]> {
    console.log('Fetching models from AIHubMix API...')
    console.log(`API URL: ${this.apiUrl}/models`)

    const response = await fetch(`${this.apiUrl}/models`)
    if (!response.ok) {
      throw new Error(`AIHubMix API error: ${response.status} ${response.statusText}`)
    }

    const rawData = await response.json()

    // Validate response with zod schema
    const parseResult = AiHubMixResponseSchema.safeParse(rawData)
    if (!parseResult.success) {
      console.error('Validation errors:', parseResult.error.issues)
      throw new Error(`Invalid API response: ${parseResult.error.message}`)
    }

    const json: AiHubMixResponse = parseResult.data
    console.log(`✓ Fetched ${json.data.length} models from AIHubMix`)

    // Transform to internal format
    console.log('Transforming models to internal format...')
    const models = json.data.map((m) => this.transformer.transform(m))
    console.log(`✓ Transformed ${models.length} models (raw)`)

    // Deduplicate models (same model ID from different variants like -free, -search)
    const deduplicatedModels = deduplicateModels(models)
    console.log(
      `✓ Deduplicated to ${deduplicatedModels.length} unique models (removed ${models.length - deduplicatedModels.length} duplicates)`
    )

    // Prepare output matching ModelListSchema format
    const output = {
      version: new Date().toISOString().split('T')[0].replace(/-/g, '.'),
      models: deduplicatedModels
    }

    // Ensure output directory exists
    const outputDir = path.dirname(outputPath)
    await fs.mkdir(outputDir, { recursive: true })

    // Write to file
    await fs.writeFile(outputPath, JSON.stringify(output, null, 2) + '\n', 'utf-8')
    console.log(`✓ Saved ${deduplicatedModels.length} unique models to ${outputPath}`)

    return deduplicatedModels
  }

  /**
   * CLI entry point
   */
  static async run(): Promise<void> {
    const importer = new AiHubMixImporter()
    const outputPath = path.join(process.cwd(), 'data', 'aihubmix-models.json')
    const mainModelsPath = path.join(process.cwd(), 'data', 'models.json')

    try {
      const models = await importer.importModels(outputPath)

      // Merge with main models.json (create if not exists)
      const version = new Date().toISOString().split('T')[0].replace(/-/g, '.')
      if (fsSync.existsSync(mainModelsPath)) {
        console.log('\nMerging with existing models.json...')
        const mainModelsData = JSON.parse(fsSync.readFileSync(mainModelsPath, 'utf-8'))

        // Deduplicate existing models first (in case of legacy duplicates)
        const existingDeduped = deduplicateModels(mainModelsData.models || [])

        // Smart merge - only fill undefined values
        const mergedModels = mergeModelsList(existingDeduped, models, MergeStrategies.FILL_UNDEFINED)

        mainModelsData.models = mergedModels
        mainModelsData.version = version
        fsSync.writeFileSync(mainModelsPath, JSON.stringify(mainModelsData, null, 2) + '\n', 'utf-8')

        console.log(`✓ Merged models.json: ${mergedModels.length} total models`)
      } else {
        console.log('\nCreating models.json...')
        const mainModelsData = { version, models }
        fsSync.writeFileSync(mainModelsPath, JSON.stringify(mainModelsData, null, 2) + '\n', 'utf-8')
        console.log(`✓ Created models.json with ${models.length} unique models`)
      }

      // Clean up temporary file after successful merge
      if (fsSync.existsSync(outputPath)) {
        fsSync.unlinkSync(outputPath)
        console.log(`✓ Cleaned up temporary file: ${path.basename(outputPath)}`)
      }

      console.log('\n✓ Import completed successfully')
    } catch (error) {
      console.error('\n✗ Import failed:', error)
      throw error
    }
  }
}
