import { contributorManager } from '@main/services/backup/contributors/ContributorManager'
import { describe, expect, it } from 'vitest'

import { ConflictResolver } from '../ConflictResolver'
import { MergeStrategyNotImplementedError } from '../MergeEngine'

describe('ConflictResolver', () => {
  const registry = contributorManager.getRegistry()
  const resolver = new ConflictResolver()

  it('uses user strategy, contributor default, then identity-class default in order', () => {
    const provider = registry.getAggregatesForDomain('PROVIDERS')[0]
    const topic = registry.getAggregatesForDomain('TOPICS')[0]

    expect(resolver.resolve(provider)).toBe('field-merge')
    expect(resolver.resolve(topic)).toBe('skip')
    expect(resolver.resolve(provider, 'SKIP')).toBe('skip')
  })

  it('keeps overwrite and rename fail-closed until their later iteration', () => {
    const provider = registry.getAggregatesForDomain('PROVIDERS')[0]

    expect(() => resolver.resolve(provider, 'OVERWRITE')).toThrow(MergeStrategyNotImplementedError)
    expect(() => resolver.resolve(provider, 'RENAME')).toThrow(MergeStrategyNotImplementedError)
  })
})
