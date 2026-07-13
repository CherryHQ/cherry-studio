import { describe, expect, it } from 'vitest'

import { safeCreateUniqueModelId } from '../values'

describe('safeCreateUniqueModelId', () => {
  it('builds a unique model id from valid parts', () => {
    expect(safeCreateUniqueModelId('anthropic', 'claude-4')).toBe('anthropic::claude-4')
  })

  it('returns undefined instead of throwing on empty parts', () => {
    expect(safeCreateUniqueModelId('', 'claude-4')).toBeUndefined()
    expect(safeCreateUniqueModelId('anthropic', '')).toBeUndefined()
  })

  it('returns undefined when providerId contains the separator', () => {
    expect(safeCreateUniqueModelId('anthropic::x', 'claude-4')).toBeUndefined()
  })

  it('returns undefined when modelId contains a reserved route character', () => {
    expect(safeCreateUniqueModelId('anthropic', 'claude?4')).toBeUndefined()
    expect(safeCreateUniqueModelId('anthropic', 'claude#4')).toBeUndefined()
  })
})
