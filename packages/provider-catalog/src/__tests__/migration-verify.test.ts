import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { fromBinary } from '@bufbuild/protobuf'
import { describe, expect, it } from 'vitest'

import { ModelCatalogSchema } from '../gen/v1/model_pb'
import { ProviderModelCatalogSchema } from '../gen/v1/provider_models_pb'
import { ProviderCatalogSchema } from '../gen/v1/provider_pb'

const DATA_DIR = resolve(__dirname, '../../data')

describe('migration verification', () => {
  it('models.pb exists and has expected count', () => {
    const path = resolve(DATA_DIR, 'models.pb')
    expect(existsSync(path)).toBe(true)

    const bytes = new Uint8Array(readFileSync(path))
    const catalog = fromBinary(ModelCatalogSchema, bytes)

    expect(catalog.models.length).toBeGreaterThan(1000)
    expect(catalog.version).toMatch(/^\d{4}\.\d{2}\.\d{2}$/)
  })

  it('providers.pb exists and has expected count', () => {
    const path = resolve(DATA_DIR, 'providers.pb')
    expect(existsSync(path)).toBe(true)

    const bytes = new Uint8Array(readFileSync(path))
    const catalog = fromBinary(ProviderCatalogSchema, bytes)

    expect(catalog.providers.length).toBeGreaterThan(40)
  })

  it('provider-models.pb exists and has expected count', () => {
    const path = resolve(DATA_DIR, 'provider-models.pb')
    expect(existsSync(path)).toBe(true)

    const bytes = new Uint8Array(readFileSync(path))
    const catalog = fromBinary(ProviderModelCatalogSchema, bytes)

    expect(catalog.overrides.length).toBeGreaterThan(0)
  })
})
