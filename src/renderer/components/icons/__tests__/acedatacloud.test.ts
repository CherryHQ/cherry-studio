import { describe, expect, it } from 'vitest'

import { resolveProviderIconRef } from '@cherrystudio/ui/icons'

import { getIconDisplayConfig } from '../iconDisplayConfig'

describe('Ace Data Cloud provider list artwork', () => {
  it('uses the existing tile sizing for the official canvas', () => {
    const ref = resolveProviderIconRef('acedatacloud')
    expect(ref?.meta.id).toBe('acedatacloud')
    expect(getIconDisplayConfig('provider-list', ref?.meta.id)).toEqual({ scale: 1, borderRadius: 5 })
  })

  it.each(['litellm', 'radeon-cloud'])('preserves the upstream tile sizing and clipping for %s', (iconId) => {
    expect(getIconDisplayConfig('provider-list', iconId)).toEqual({ scale: 1, borderRadius: 5 })
  })
})
