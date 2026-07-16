import { describe, expect, it } from 'vitest'

import { withResponsesStoreDefault } from '../Agent'

describe('withResponsesStoreDefault', () => {
  it('defaults store off for the openai Responses adapter (grok-cli/codex proxies reject item_reference replay)', () => {
    expect(withResponsesStoreDefault('openai', undefined)).toEqual({ openai: { store: false } })
  })

  it('preserves other provider options while injecting the default', () => {
    expect(withResponsesStoreDefault('openai', { openai: { serviceTier: 'flex' } })).toEqual({
      openai: { store: false, serviceTier: 'flex' }
    })
  })

  it('lets an explicit caller store value win', () => {
    expect(withResponsesStoreDefault('openai', { openai: { store: true } })).toEqual({ openai: { store: true } })
  })

  it('leaves non-openai providers untouched', () => {
    expect(withResponsesStoreDefault('anthropic', undefined)).toBeUndefined()
    const options = { anthropic: { thinking: { type: 'enabled' } } }
    expect(withResponsesStoreDefault('openai-compatible', options)).toBe(options)
  })
})
