/**
 * Tests that the catalog I/O helpers correctly roundtrip data:
 * JSON → proto → binary → proto → JSON
 *
 * This verifies the conversion layer used by pipeline scripts.
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { fromBinary } from '@bufbuild/protobuf'
import { describe, expect, it } from 'vitest'

import {
  convertModelConfig,
  convertProviderConfig,
  convertProviderModelOverride
} from '../../scripts/shared/json-to-proto'
import { ModelCatalogSchema } from '../gen/v1/model_pb'
import { ProviderModelCatalogSchema } from '../gen/v1/provider_models_pb'
import { ProviderCatalogSchema } from '../gen/v1/provider_pb'
// Import converters directly for testing
import { protoModelToJson, protoOverrideToJson, protoProviderToJson } from '../utils/proto-to-json'

const DATA_DIR = resolve(import.meta.dirname, '../../data')

describe('catalog I/O roundtrip', () => {
  it('models roundtrip: .pb → JSON → proto → binary matches original', () => {
    const pbPath = resolve(DATA_DIR, 'models.pb')
    if (!existsSync(pbPath)) return

    const originalBytes = new Uint8Array(readFileSync(pbPath))
    const catalog = fromBinary(ModelCatalogSchema, originalBytes)

    // Convert first 50 models through the full roundtrip
    const sample = catalog.models.slice(0, 50)
    for (const protoModel of sample) {
      const json = protoModelToJson(protoModel)
      const roundtripped = convertModelConfig(json)

      // Key fields should match
      expect(roundtripped.id).toBe(protoModel.id)
      expect(roundtripped.name).toBe(protoModel.name)
      expect(roundtripped.contextWindow).toBe(protoModel.contextWindow)
      expect(roundtripped.maxOutputTokens).toBe(protoModel.maxOutputTokens)
      expect(roundtripped.capabilities).toEqual(protoModel.capabilities)
      expect(roundtripped.inputModalities).toEqual(protoModel.inputModalities)
      expect(roundtripped.outputModalities).toEqual(protoModel.outputModalities)

      // Check reasoning roundtrip if present
      if (protoModel.reasoning) {
        expect(roundtripped.reasoning?.params?.case).toBe(protoModel.reasoning.params?.case)
        expect(roundtripped.reasoning?.common?.supportedEfforts).toEqual(protoModel.reasoning.common?.supportedEfforts)
      }
    }
  })

  it('providers roundtrip: .pb → JSON → proto → binary matches original', () => {
    const pbPath = resolve(DATA_DIR, 'providers.pb')
    if (!existsSync(pbPath)) return

    const originalBytes = new Uint8Array(readFileSync(pbPath))
    const catalog = fromBinary(ProviderCatalogSchema, originalBytes)

    for (const protoProvider of catalog.providers) {
      const json = protoProviderToJson(protoProvider)
      const roundtripped = convertProviderConfig(json)

      expect(roundtripped.id).toBe(protoProvider.id)
      expect(roundtripped.name).toBe(protoProvider.name)
      expect(roundtripped.defaultChatEndpoint).toBe(protoProvider.defaultChatEndpoint)

      // Check baseUrls roundtrip
      for (const [key, value] of Object.entries(protoProvider.baseUrls)) {
        expect(roundtripped.baseUrls[Number(key)]).toBe(value)
      }
    }
  })

  it('provider-models roundtrip: .pb → JSON → proto → binary matches original', () => {
    const pbPath = resolve(DATA_DIR, 'provider-models.pb')
    if (!existsSync(pbPath)) return

    const originalBytes = new Uint8Array(readFileSync(pbPath))
    const catalog = fromBinary(ProviderModelCatalogSchema, originalBytes)

    // Test first 100 overrides
    const sample = catalog.overrides.slice(0, 100)
    for (const protoOverride of sample) {
      const json = protoOverrideToJson(protoOverride)
      const roundtripped = convertProviderModelOverride(json)

      expect(roundtripped.providerId).toBe(protoOverride.providerId)
      expect(roundtripped.modelId).toBe(protoOverride.modelId)
      expect(roundtripped.apiModelId).toBe(protoOverride.apiModelId)
      expect(roundtripped.priority).toBe(protoOverride.priority)
      expect(roundtripped.endpointTypes).toEqual(protoOverride.endpointTypes)
    }
  })
})
