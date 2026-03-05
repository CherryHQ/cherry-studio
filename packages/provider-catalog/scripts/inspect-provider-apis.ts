#!/usr/bin/env tsx

/**
 * Inspect Provider APIs
 *
 * This script fetches actual API responses from providers to understand
 * their response structure. Use this to create accurate Zod schemas.
 *
 * Usage:
 *   npx tsx scripts/inspect-provider-apis.ts [provider-id]
 *
 * Examples:
 *   npx tsx scripts/inspect-provider-apis.ts              # Inspect all providers
 *   npx tsx scripts/inspect-provider-apis.ts openrouter   # Inspect specific provider
 *   npx tsx scripts/inspect-provider-apis.ts mistral groq # Inspect multiple providers
 *
 * Note: Reads provider configuration from data/providers.json
 *       If providers.json doesn't exist, run `npx tsx scripts/generate-providers.ts` first
 */

import * as dotenv from 'dotenv'
dotenv.config({ override: true })

import * as fs from 'fs'
import * as path from 'path'

import type { ProviderConfig } from '../src/schemas'
import { getApiKey, getAuthHeaders } from './shared/api-keys'

// ═══════════════════════════════════════════════════════════════════════════════
// Utilities
// ═══════════════════════════════════════════════════════════════════════════════

function analyzeObjectStructure(obj: unknown, depth = 0, maxDepth = 3): unknown {
  if (depth > maxDepth) return '...'

  if (obj === null) return 'null'
  if (obj === undefined) return 'undefined'

  const type = typeof obj

  if (type === 'string') {
    const str = obj as string
    return `string (e.g., "${str.slice(0, 50)}${str.length > 50 ? '...' : ''}")`
  }
  if (type === 'number') return `number (e.g., ${obj})`
  if (type === 'boolean') return `boolean (${obj})`

  if (Array.isArray(obj)) {
    if (obj.length === 0) return 'array (empty)'
    return {
      _type: `array[${obj.length}]`,
      _sample: analyzeObjectStructure(obj[0], depth + 1, maxDepth)
    }
  }

  if (type === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = analyzeObjectStructure(value, depth + 1, maxDepth)
    }
    return result
  }

  return type
}

function printSampleModels(data: unknown, count = 2): void {
  let models: unknown[] = []

  if (Array.isArray(data)) {
    models = data
  } else if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>
    if (Array.isArray(obj.data)) {
      models = obj.data
    } else if (Array.isArray(obj.models)) {
      models = obj.models
    }
  }

  if (models.length === 0) {
    console.log('    No models found in response')
    return
  }

  console.log(`\n    Sample models (${Math.min(count, models.length)} of ${models.length}):`)
  for (let i = 0; i < Math.min(count, models.length); i++) {
    console.log(`\n    [${i}] ${JSON.stringify(models[i], null, 2).split('\n').join('\n    ')}`)
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════════

async function inspectUrl(providerId: string, urlType: string, url: string): Promise<void> {
  const apiKey = getApiKey(providerId)
  const headers = getAuthHeaders(providerId, apiKey)

  console.log(`\n    [${urlType}] ${url}`)
  if (!apiKey) {
    console.log('      ⚠ No API key, attempting without auth...')
  }

  try {
    const response = await fetch(url, { headers })
    console.log(`      Status: ${response.status} ${response.statusText}`)

    if (!response.ok) {
      const errorText = await response.text()
      console.log(`      ✗ Error: ${errorText.slice(0, 200)}${errorText.length > 200 ? '...' : ''}`)
      return
    }

    const data = await response.json()

    // Analyze structure
    console.log(`      Structure:`)
    const structure = analyzeObjectStructure(data, 0, 2)
    const structureStr = JSON.stringify(structure, null, 2).split('\n').join('\n        ')
    console.log(`        ${structureStr}`)

    // Print sample models
    printSampleModels(data, 2)

    // Save full response
    const outputDir = path.join(__dirname, '../data/api-responses')
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true })
    }
    const filename = urlType === 'default' ? `${providerId}.json` : `${providerId}-${urlType}.json`
    const outputPath = path.join(outputDir, filename)
    fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf-8')
    console.log(`      ✓ Saved to: ${outputPath}`)
  } catch (error) {
    console.log(`      ✗ Fetch failed: ${error instanceof Error ? error.message : error}`)
  }
}

async function inspectProvider(provider: ProviderConfig): Promise<void> {
  console.log(`\n${'═'.repeat(70)}`)
  console.log(`Provider: ${provider.id} (${provider.name})`)
  console.log('═'.repeat(70))

  if (!provider.modelsApiUrls) {
    console.log('  No modelsApiUrls configured')
    return
  }

  const urlEntries = Object.entries(provider.modelsApiUrls).filter(([, url]) => url)
  console.log(`  URLs: ${urlEntries.length}`)

  for (const [urlType, url] of urlEntries) {
    if (url) {
      await inspectUrl(provider.id, urlType, url)
    }
  }
}

async function main() {
  const args = process.argv.slice(2)

  console.log('Provider API Inspector')
  console.log('='.repeat(70))
  console.log('Fetches actual API responses to help create accurate schemas.')
  console.log('')

  // Load providers from providers.json
  const providersPath = path.join(__dirname, '../data/providers.json')
  if (!fs.existsSync(providersPath)) {
    console.error('Error: data/providers.json not found')
    console.error('Run `npx tsx scripts/generate-providers.ts` first')
    process.exit(1)
  }

  const providersData = JSON.parse(fs.readFileSync(providersPath, 'utf-8'))
  const allProviders: ProviderConfig[] = providersData.providers

  // Filter providers with modelsApiUrls
  let providers = allProviders.filter((p) => p.modelsApiUrls)

  // Filter by command line args if specified
  if (args.length > 0) {
    providers = providers.filter((p) => args.includes(p.id))
    if (providers.length === 0) {
      const available = allProviders.filter((p) => p.modelsApiUrls).map((p) => p.id)
      console.log(`No matching providers found for: ${args.join(', ')}`)
      console.log(`\nAvailable providers: ${available.join(', ')}`)
      process.exit(1)
    }
    console.log(`Inspecting: ${providers.map((p) => p.id).join(', ')}`)
  } else {
    console.log(`Inspecting all ${providers.length} providers with modelsApiUrls`)
  }

  // Check API keys
  console.log('\nAPI Key Status:')
  const configured = providers.filter((p) => getApiKey(p.id)).map((p) => p.id)
  const missing = providers.filter((p) => !getApiKey(p.id)).map((p) => p.id)

  if (configured.length > 0) {
    console.log(`  ✓ Configured: ${configured.join(', ')}`)
  }
  if (missing.length > 0) {
    console.log(`  ✗ Missing: ${missing.join(', ')}`)
  }

  // Inspect each provider
  for (const provider of providers) {
    await inspectProvider(provider)
  }

  console.log('\n' + '='.repeat(70))
  console.log('Inspection complete!')
  console.log('Check the data/api-responses/ directory for full JSON responses.')
  console.log('='.repeat(70))
}

main().catch(console.error)
