/**
 * Read-only catalog reader for .pb files.
 *
 * Reads protobuf catalog data and returns proto Message types directly.
 * No JSON conversion — proto types are the single source of truth.
 */

import { readFileSync } from 'node:fs'

import { fromBinary } from '@bufbuild/protobuf'

import type { ModelConfig } from './gen/v1/model_pb'
import { ModelCatalogSchema } from './gen/v1/model_pb'
import type { ProviderModelOverride } from './gen/v1/provider_models_pb'
import { ProviderModelCatalogSchema } from './gen/v1/provider_models_pb'
import type { ProviderConfig } from './gen/v1/provider_pb'
import { ProviderCatalogSchema } from './gen/v1/provider_pb'

export function readModelCatalog(pbPath: string): { version: string; models: ModelConfig[] } {
  const bytes = readFileSync(pbPath)
  const catalog = fromBinary(ModelCatalogSchema, new Uint8Array(bytes))
  return { version: catalog.version, models: [...catalog.models] }
}

export function readProviderCatalog(pbPath: string): { version: string; providers: ProviderConfig[] } {
  const bytes = readFileSync(pbPath)
  const catalog = fromBinary(ProviderCatalogSchema, new Uint8Array(bytes))
  return { version: catalog.version, providers: [...catalog.providers] }
}

export function readProviderModelCatalog(pbPath: string): { version: string; overrides: ProviderModelOverride[] } {
  const bytes = readFileSync(pbPath)
  const catalog = fromBinary(ProviderModelCatalogSchema, new Uint8Array(bytes))
  return { version: catalog.version, overrides: [...catalog.overrides] }
}
