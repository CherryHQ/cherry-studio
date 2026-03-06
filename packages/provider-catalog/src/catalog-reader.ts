/**
 * Read-only catalog reader for .pb files.
 *
 * Provides high-level functions to read protobuf catalog data and convert
 * to plain JSON objects with string enum values. Used by the main app
 * (CatalogService) to load catalog data at runtime.
 */

import { readFileSync } from 'node:fs'

import { fromBinary } from '@bufbuild/protobuf'

import { ModelCatalogSchema } from './gen/v1/model_pb'
import { ProviderModelCatalogSchema } from './gen/v1/provider_models_pb'
import { ProviderCatalogSchema } from './gen/v1/provider_pb'
import type { ModelConfig, ProviderConfig, ProviderModelOverride } from './schemas'
import { protoModelToJson, protoOverrideToJson, protoProviderToJson } from './utils/proto-to-json'

export function readModelCatalog(pbPath: string): { version: string; models: ModelConfig[] } {
  const bytes = readFileSync(pbPath)
  const catalog = fromBinary(ModelCatalogSchema, new Uint8Array(bytes))
  return {
    version: catalog.version,
    models: catalog.models.map(protoModelToJson) as ModelConfig[]
  }
}

export function readProviderCatalog(pbPath: string): { version: string; providers: ProviderConfig[] } {
  const bytes = readFileSync(pbPath)
  const catalog = fromBinary(ProviderCatalogSchema, new Uint8Array(bytes))
  return {
    version: catalog.version,
    providers: catalog.providers.map(protoProviderToJson) as ProviderConfig[]
  }
}

export function readProviderModelCatalog(pbPath: string): { version: string; overrides: ProviderModelOverride[] } {
  const bytes = readFileSync(pbPath)
  const catalog = fromBinary(ProviderModelCatalogSchema, new Uint8Array(bytes))
  return {
    version: catalog.version,
    overrides: catalog.overrides.map(protoOverrideToJson) as ProviderModelOverride[]
  }
}
