#!/usr/bin/env tsx

/**
 * Clean up models with invalid pricing (null values)
 */

import fs from 'fs/promises'
import path from 'path'

const DATA_DIR = path.join(__dirname, '../data')

async function cleanupInvalidPricing() {
  console.log('Cleaning up models with invalid pricing...\n')

  const modelsPath = path.join(DATA_DIR, 'models.json')
  const modelsData = JSON.parse(await fs.readFile(modelsPath, 'utf-8'))

  let fixed = 0

  for (const model of modelsData.models) {
    if (model.pricing) {
      const hasNullInput = model.pricing.input?.per_million_tokens == null
      const hasNullOutput = model.pricing.output?.per_million_tokens == null

      if (hasNullInput || hasNullOutput) {
        console.log(`Removing invalid pricing from: ${model.id}`)
        delete model.pricing
        fixed++
      }
    }
  }

  if (fixed > 0) {
    await fs.writeFile(modelsPath, JSON.stringify(modelsData, null, 2) + '\n', 'utf-8')
    console.log(`\n✓ Fixed ${fixed} models with invalid pricing`)
  } else {
    console.log('✓ No invalid pricing found')
  }
}

cleanupInvalidPricing().catch(console.error)
