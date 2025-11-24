#!/usr/bin/env tsx

/**
 * Migration Script - Phase 2 Implementation
 * Usage: npx tsx migrate.ts
 */

import * as path from 'path'

import { MigrationTool } from '../src/utils/migration'

async function main() {
  const packageRoot = path.resolve(__dirname, '..')
  const sourceDir = packageRoot
  const outputDir = path.join(packageRoot, 'data')

  console.log('🔧 Cherry Studio Catalog Migration - Phase 2')
  console.log('==========================================')
  console.log(`📁 Source: ${sourceDir}`)
  console.log(`📁 Output: ${outputDir}`)
  console.log('')

  const tool = new MigrationTool(
    path.join(sourceDir, 'provider_endpoints_support.json'),
    path.join(sourceDir, 'model_prices_and_context_window.json'),
    outputDir
  )

  try {
    await tool.migrate()
    console.log('')
    console.log('🎉 Migration completed! Check the src/data/ directory for results.')
  } catch (error) {
    console.error('❌ Migration failed:', error)
    process.exit(1)
  }
}

main()
