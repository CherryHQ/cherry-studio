/**
 * High-level read/write helpers for catalog .pb files.
 *
 * These convert between protobuf binary format and the plain JSON objects
 * that pipeline scripts expect (string enum values, flat metadata, etc.).
 */

import { readFileSync, writeFileSync } from 'node:fs'

import { create, fromBinary, toBinary } from '@bufbuild/protobuf'

import { ModelCatalogSchema } from '../../src/gen/v1/model_pb'
import { ProviderModelCatalogSchema } from '../../src/gen/v1/provider_models_pb'
import { ProviderCatalogSchema } from '../../src/gen/v1/provider_pb'
import { convertModelConfig, convertProviderConfig, convertProviderModelOverride } from './json-to-proto'
import { protoModelToJson, protoOverrideToJson, protoProviderToJson } from './proto-to-json'

// ═══════════════════════════════════════════════════════════════════════════════
// Models catalog
// ═══════════════════════════════════════════════════════════════════════════════

// biome-ignore lint/suspicious/noExplicitAny: pipeline scripts use untyped objects
export function readModels(pbPath: string): { version: string; models: any[] } {
  const bytes = readFileSync(pbPath)
  const catalog = fromBinary(ModelCatalogSchema, new Uint8Array(bytes))
  return {
    version: catalog.version,
    models: catalog.models.map(protoModelToJson)
  }
}

// biome-ignore lint/suspicious/noExplicitAny: pipeline scripts use untyped objects
export function writeModels(pbPath: string, data: { version: string; models: any[] }): void {
  const catalog = create(ModelCatalogSchema, {
    version: data.version,
    models: data.models.map(convertModelConfig)
  })
  const bytes = toBinary(ModelCatalogSchema, catalog)
  writeFileSync(pbPath, bytes)
  console.log(`Wrote ${pbPath} (${bytes.length} bytes, ${(bytes.length / 1024).toFixed(1)}KB)`)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Providers catalog
// ═══════════════════════════════════════════════════════════════════════════════

// biome-ignore lint/suspicious/noExplicitAny: pipeline scripts use untyped objects
export function readProviders(pbPath: string): { version: string; providers: any[] } {
  const bytes = readFileSync(pbPath)
  const catalog = fromBinary(ProviderCatalogSchema, new Uint8Array(bytes))
  return {
    version: catalog.version,
    providers: catalog.providers.map(protoProviderToJson)
  }
}

// biome-ignore lint/suspicious/noExplicitAny: pipeline scripts use untyped objects
export function writeProviders(pbPath: string, data: { version: string; providers: any[] }): void {
  const catalog = create(ProviderCatalogSchema, {
    version: data.version,
    providers: data.providers.map(convertProviderConfig)
  })
  const bytes = toBinary(ProviderCatalogSchema, catalog)
  writeFileSync(pbPath, bytes)
  console.log(`Wrote ${pbPath} (${bytes.length} bytes, ${(bytes.length / 1024).toFixed(1)}KB)`)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Provider models catalog
// ═══════════════════════════════════════════════════════════════════════════════

// biome-ignore lint/suspicious/noExplicitAny: pipeline scripts use untyped objects
export function readProviderModels(pbPath: string): { version: string; overrides: any[] } {
  const bytes = readFileSync(pbPath)
  const catalog = fromBinary(ProviderModelCatalogSchema, new Uint8Array(bytes))
  return {
    version: catalog.version,
    overrides: catalog.overrides.map(protoOverrideToJson)
  }
}

// biome-ignore lint/suspicious/noExplicitAny: pipeline scripts use untyped objects
export function writeProviderModels(pbPath: string, data: { version: string; overrides: any[] }): void {
  const catalog = create(ProviderModelCatalogSchema, {
    version: data.version,
    overrides: data.overrides.map(convertProviderModelOverride)
  })
  const bytes = toBinary(ProviderModelCatalogSchema, catalog)
  writeFileSync(pbPath, bytes)
  console.log(`Wrote ${pbPath} (${bytes.length} bytes, ${(bytes.length / 1024).toFixed(1)}KB)`)
}
