/**
 * One-time migration: JSON data files → protobuf binary files
 *
 * Reads: data/models.json, data/providers.json, data/provider-models.json
 * Writes: data/models.pb, data/providers.pb, data/provider-models.pb
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { create, toBinary } from '@bufbuild/protobuf'

import { ModelCatalogSchema } from '../src/gen/v1/model_pb'
import { ProviderModelCatalogSchema } from '../src/gen/v1/provider_models_pb'
import { ProviderCatalogSchema } from '../src/gen/v1/provider_pb'
import { convertModelConfig, convertProviderConfig, convertProviderModelOverride } from './shared/json-to-proto'

const DATA_DIR = resolve(__dirname, '../data')

// ═══════════════════════════════════════════════════════════════════════════════
// Main migration logic
// ═══════════════════════════════════════════════════════════════════════════════

function migrateModels(): void {
  const raw = JSON.parse(readFileSync(resolve(DATA_DIR, 'models.json'), 'utf-8'))
  console.log(`Read ${raw.models.length} models from models.json`)

  const catalog = create(ModelCatalogSchema, {
    version: raw.version,
    models: raw.models.map(convertModelConfig)
  })

  const bytes = toBinary(ModelCatalogSchema, catalog)
  writeFileSync(resolve(DATA_DIR, 'models.pb'), bytes)
  console.log(`Wrote models.pb (${bytes.length} bytes, ${(bytes.length / 1024).toFixed(1)}KB)`)
}

function migrateProviders(): void {
  const raw = JSON.parse(readFileSync(resolve(DATA_DIR, 'providers.json'), 'utf-8'))
  console.log(`Read ${raw.providers.length} providers from providers.json`)

  const catalog = create(ProviderCatalogSchema, {
    version: raw.version,
    providers: raw.providers.map(convertProviderConfig)
  })

  const bytes = toBinary(ProviderCatalogSchema, catalog)
  writeFileSync(resolve(DATA_DIR, 'providers.pb'), bytes)
  console.log(`Wrote providers.pb (${bytes.length} bytes, ${(bytes.length / 1024).toFixed(1)}KB)`)
}

function migrateProviderModels(): void {
  const raw = JSON.parse(readFileSync(resolve(DATA_DIR, 'provider-models.json'), 'utf-8'))
  console.log(`Read ${raw.overrides.length} overrides from provider-models.json`)

  const catalog = create(ProviderModelCatalogSchema, {
    version: raw.version,
    overrides: raw.overrides.map(convertProviderModelOverride)
  })

  const bytes = toBinary(ProviderModelCatalogSchema, catalog)
  writeFileSync(resolve(DATA_DIR, 'provider-models.pb'), bytes)
  console.log(`Wrote provider-models.pb (${bytes.length} bytes, ${(bytes.length / 1024).toFixed(1)}KB)`)
}

// --- Run ---
console.log('Starting JSON → Protobuf migration...\n')
migrateModels()
migrateProviders()
migrateProviderModels()
console.log('\nMigration complete!')
