import { describe, expect, it } from 'vitest'

import { ppioProvider } from '../../providers/ppio/provider'
import { zhipuProvider } from '../../providers/zhipu/provider'
import { resolvePaintingTabForMode } from '../paintingProviderMode'

describe('resolvePaintingTabForMode', () => {
  it('returns the matching tab when a provider supports the requested db mode', () => {
    expect(resolvePaintingTabForMode(ppioProvider, 'edit')).toBe('ppio_edit')
    expect(resolvePaintingTabForMode(ppioProvider, 'draw')).toBe('ppio_draw')
  })

  it('returns undefined when the provider does not support that db mode', () => {
    expect(resolvePaintingTabForMode(zhipuProvider, 'edit')).toBeUndefined()
  })
})
