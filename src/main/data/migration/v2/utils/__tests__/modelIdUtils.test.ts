import { describe, expect, it } from 'vitest'

import { buildCompositeModelId } from '../modelIdUtils'

describe('buildCompositeModelId', () => {
  it('should build "provider::modelId" from valid provider and id', () => {
    expect(buildCompositeModelId({ provider: 'openai', id: 'gpt-4' })).toBe('openai::gpt-4')
  })

  it('should trim whitespace from provider and id', () => {
    expect(buildCompositeModelId({ provider: ' openai ', id: ' gpt-4 ' })).toBe('openai::gpt-4')
  })

  it('should return null when provider is missing', () => {
    expect(buildCompositeModelId({ id: 'gpt-4' })).toBeNull()
  })

  it('should return null when id is missing', () => {
    expect(buildCompositeModelId({ provider: 'openai' })).toBeNull()
  })

  it('should return null when both are missing', () => {
    expect(buildCompositeModelId({})).toBeNull()
  })

  it('should return null when provider is empty string', () => {
    expect(buildCompositeModelId({ provider: '', id: 'gpt-4' })).toBeNull()
  })

  it('should return null when id is empty string', () => {
    expect(buildCompositeModelId({ provider: 'openai', id: '' })).toBeNull()
  })

  it('should return null when provider is whitespace only', () => {
    expect(buildCompositeModelId({ provider: '  ', id: 'gpt-4' })).toBeNull()
  })

  it('should return null when provider is non-string', () => {
    expect(buildCompositeModelId({ provider: 123, id: 'gpt-4' })).toBeNull()
  })

  it('should return null when id is non-string', () => {
    expect(buildCompositeModelId({ provider: 'openai', id: 42 })).toBeNull()
  })

  it('should handle provider::id with colons in modelId', () => {
    expect(buildCompositeModelId({ provider: 'azure', id: 'gpt-4:2025-04' })).toBe('azure::gpt-4:2025-04')
  })
})
