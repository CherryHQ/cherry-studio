/**
 * Read-only registry reader for .pb files.
 *
 * Reads protobuf registry data and returns proto Message types directly.
 * No JSON conversion — proto types are the single source of truth.
 */

import { readFileSync } from 'node:fs'

import { fromBinary } from '@bufbuild/protobuf'

import type { ModelConfig } from './gen/v1/model_pb'
import { ModelRegistrySchema } from './gen/v1/model_pb'
import type { ProviderModelOverride } from './gen/v1/provider_models_pb'
import { ProviderModelRegistrySchema } from './gen/v1/provider_models_pb'
import type { ProviderConfig } from './gen/v1/provider_pb'
import { ProviderRegistrySchema } from './gen/v1/provider_pb'

export function readModelRegistry(pbPath: string): { version: string; models: ModelConfig[] } {
  const bytes = readFileSync(pbPath)
  const registry = fromBinary(ModelRegistrySchema, new Uint8Array(bytes))
  return { version: registry.version, models: [...registry.models] }
}

export function readProviderRegistry(pbPath: string): { version: string; providers: ProviderConfig[] } {
  const bytes = readFileSync(pbPath)
  const registry = fromBinary(ProviderRegistrySchema, new Uint8Array(bytes))
  return { version: registry.version, providers: [...registry.providers] }
}

export function readProviderModelRegistry(pbPath: string): { version: string; overrides: ProviderModelOverride[] } {
  const bytes = readFileSync(pbPath)
  const registry = fromBinary(ProviderModelRegistrySchema, new Uint8Array(bytes))
  return { version: registry.version, overrides: [...registry.overrides] }
}
