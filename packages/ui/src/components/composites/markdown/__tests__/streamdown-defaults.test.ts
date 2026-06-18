import { defaultRehypePlugins } from 'streamdown'
import { describe, expect, it } from 'vitest'

describe('Streamdown default rehype plugin shape', () => {
  it('keeps raw, sanitize tuple, and harden entries available for MarkdownCore', () => {
    const plugins = defaultRehypePlugins as Partial<Record<string, unknown>>
    const sanitize = plugins.sanitize

    expect(typeof plugins.raw).toBe('function')
    expect(Array.isArray(sanitize)).toBe(true)
    expect(sanitize).toHaveLength(2)
    expect(typeof sanitize?.[0]).toBe('function')
    expect(typeof sanitize?.[1]).toBe('object')
    expect(typeof plugins.harden === 'function' || Array.isArray(plugins.harden)).toBe(true)
  })
})
