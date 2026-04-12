import { describe, expect, it } from 'vitest'

import { createUniqueModelId } from '../modelIdUtils'

describe('createUniqueModelId (re-export)', () => {
  it('should build "provider::modelId" from valid provider and id', () => {
    expect(createUniqueModelId('openai', 'gpt-4')).toBe('openai::gpt-4')
  })

  it('should handle colons in modelId', () => {
    expect(createUniqueModelId('azure', 'gpt-4:2025-04')).toBe('azure::gpt-4:2025-04')
  })

  it('should throw when provider contains separator', () => {
    expect(() => createUniqueModelId('open::ai', 'gpt-4')).toThrow()
  })
})
