#!/usr/bin/env tsx

/**
 * Cleanup script for data/overrides.json
 * Removes deprecated tracking fields: last_updated, updated_by
 * These fields will be removed from override schema as git provides better tracking
 */

import * as fs from 'fs/promises'
import * as path from 'path'

interface Override {
  provider_id: string
  model_id: string
  disabled?: boolean
  reason?: string
  priority?: number
  last_updated?: string // To be removed
  updated_by?: string // To be removed
  limits?: unknown
  pricing?: unknown
  capabilities?: unknown
  reasoning?: unknown
  parameters?: unknown
  replace_with?: string
  [key: string]: unknown
}

interface OverrideFile {
  version: string
  overrides: Override[]
}

async function cleanupOverrides(): Promise<void> {
  const overridesPath = path.join(process.cwd(), 'data', 'overrides.json')

  console.log('Reading overrides file...')
  const content = await fs.readFile(overridesPath, 'utf-8')
  const data: OverrideFile = JSON.parse(content)

  console.log(`Found ${data.overrides.length} override entries`)

  let removedCount = 0
  const cleanedOverrides = data.overrides.map((override) => {
    const cleaned: Override = { ...override }

    // Remove deprecated tracking fields
    if ('last_updated' in cleaned) {
      delete cleaned.last_updated
      removedCount++
    }
    if ('updated_by' in cleaned) {
      delete cleaned.updated_by
    }

    return cleaned
  })

  const cleanedData: OverrideFile = {
    version: data.version,
    overrides: cleanedOverrides
  }

  // Write cleaned data back
  console.log(`Removing last_updated and updated_by from ${removedCount} entries...`)
  await fs.writeFile(overridesPath, JSON.stringify(cleanedData, null, 2) + '\n', 'utf-8')

  console.log('✓ Cleanup completed successfully')
  console.log(`✓ Saved ${cleanedOverrides.length} cleaned override entries`)
}

// Run the cleanup
cleanupOverrides().catch((error) => {
  console.error('Cleanup failed:', error)
  process.exit(1)
})
