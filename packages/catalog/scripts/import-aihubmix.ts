#!/usr/bin/env tsx

/**
 * One-time import script for AIHubMix model catalog
 * Usage: yarn import:aihubmix
 * Output: data/aihubmix-models.json
 */

import { AiHubMixImporter } from '../src/utils/importers'

async function main() {
  console.log('AIHubMix Model Importer')
  console.log('=======================\n')

  try {
    await AiHubMixImporter.run()
    process.exit(0)
  } catch (error) {
    console.error('Import failed:', error)
    process.exit(1)
  }
}

main()
