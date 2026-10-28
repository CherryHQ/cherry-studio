import { describe, expect, it } from 'vitest'

import { ProviderSchema } from '../provider'

const ENDPOINT_CONFIGS_SCHEMA = ProviderSchema.shape.endpointConfigs.unwrap()

describe('ProviderSchema endpointConfigs', () => {
  it('accepts sparse and empty endpoint configuration', () => {
    expect(ENDPOINT_CONFIGS_SCHEMA.safeParse({ 'openai-responses': { baseUrl: 'https://example.com' } }).success).toBe(
      true
    )
    expect(ENDPOINT_CONFIGS_SCHEMA.safeParse({}).success).toBe(true)
  })

  it('rejects unknown endpoint types and invalid configuration values', () => {
    expect(ENDPOINT_CONFIGS_SCHEMA.safeParse({ unknown: { baseUrl: 'https://example.com' } }).success).toBe(false)
    expect(ENDPOINT_CONFIGS_SCHEMA.safeParse({ 'openai-responses': { baseUrl: 42 } }).success).toBe(false)
  })
})
