#!/usr/bin/env tsx

/**
 * Import script for AIHubMix model catalog
 * Usage: yarn import:aihubmix
 * Output: data/aihubmix-models.json (intermediate), merged into data/models.pb
 */

import * as fs from 'fs'
import * as path from 'path'

import { AiHubMixImporter } from '../src/utils/importers'
import { deduplicateModels, mergeModelsList, MergeStrategies } from '../src/utils/merge-utils'
import { readModels, writeModels } from './shared/catalog-io'

async function main() {
  console.log('AIHubMix Model Importer')
  console.log('=======================\n')

  try {
    const importer = new AiHubMixImporter()
    const outputPath = path.join(__dirname, '../data/aihubmix-models.json')
    const mainModelsPbPath = path.join(__dirname, '../data/models.pb')
    const mainModelsJsonPath = path.join(__dirname, '../data/models.json')

    // Import and save intermediate file
    const models = await importer.importModels(outputPath)

    // Deduplicate
    const deduplicatedModels = deduplicateModels(models)
    console.log(
      `✓ Deduplicated to ${deduplicatedModels.length} unique models (removed ${models.length - deduplicatedModels.length} duplicates)`
    )

    // Merge with main models.pb (create if not exists)
    const version = new Date().toISOString().split('T')[0].replace(/-/g, '.')
    if (fs.existsSync(mainModelsPbPath)) {
      console.log('\nMerging with existing models.pb...')
      const mainModelsData = readModels(mainModelsPbPath)

      // Deduplicate existing models first (in case of legacy duplicates)
      const existingDeduped = deduplicateModels(mainModelsData.models || [])

      // Smart merge - only fill undefined values
      const mergedModels = mergeModelsList(existingDeduped, deduplicatedModels, MergeStrategies.FILL_UNDEFINED)

      mainModelsData.models = mergedModels
      mainModelsData.version = version
      writeModels(mainModelsPbPath, mainModelsData)
      // Also write JSON for debugging
      fs.writeFileSync(mainModelsJsonPath, JSON.stringify(mainModelsData, null, 2) + '\n', 'utf-8')

      console.log(`✓ Merged models.pb: ${mergedModels.length} total models`)
      console.log(`  - Preserved existing non-undefined values`)
      console.log(`  - Filled in undefined values from AIHubMix`)
    } else {
      console.log('\nCreating models.pb...')
      const mainModelsData = { version, models: deduplicatedModels }
      writeModels(mainModelsPbPath, mainModelsData)
      fs.writeFileSync(mainModelsJsonPath, JSON.stringify(mainModelsData, null, 2) + '\n', 'utf-8')
      console.log(`✓ Created models.pb with ${deduplicatedModels.length} unique models`)
    }

    // Clean up temporary file after successful merge
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath)
      console.log(`✓ Cleaned up temporary file: ${path.basename(outputPath)}`)
    }

    console.log('\n✓ Import complete!')
    process.exit(0)
  } catch (error) {
    console.error('Import failed:', error)
    process.exit(1)
  }
}

main()
