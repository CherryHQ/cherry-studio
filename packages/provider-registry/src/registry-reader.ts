/**
 * Read-only registry reader for JSON files.
 *
 * Reads JSON registry data and validates against Zod schemas.
 */

import { readFileSync } from 'node:fs'

import type { ModelConfig } from './schemas/model'
import { ModelListSchema } from './schemas/model'
import type { ProviderConfig } from './schemas/provider'
import { ProviderListSchema } from './schemas/provider'
import type { ProviderModelOverride } from './schemas/provider-models'
import { ProviderModelListSchema } from './schemas/provider-models'

export function readModelRegistry(jsonPath: string): { version: string; models: ModelConfig[] } {
  const data = JSON.parse(readFileSync(jsonPath, 'utf-8'))
  const registry = ModelListSchema.parse(data)
  return { version: registry.version, models: registry.models }
}

export function readProviderRegistry(jsonPath: string): { version: string; providers: ProviderConfig[] } {
  const data = JSON.parse(readFileSync(jsonPath, 'utf-8'))
  const registry = ProviderListSchema.parse(data)
  return { version: registry.version, providers: registry.providers }
}

export function readProviderModelRegistry(jsonPath: string): { version: string; overrides: ProviderModelOverride[] } {
  const data = JSON.parse(readFileSync(jsonPath, 'utf-8'))
  const registry = ProviderModelListSchema.parse(data)
  return { version: registry.version, overrides: registry.overrides }
}
