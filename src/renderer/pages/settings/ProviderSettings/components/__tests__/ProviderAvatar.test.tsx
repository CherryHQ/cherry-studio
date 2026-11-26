import { describe, expect, it } from 'vitest'

import { resolveProviderAvatarResolution } from '../ProviderAvatar'

describe('resolveProviderAvatarResolution', () => {
  it('resolves the seeded ModelRush preset to the bundled icon', () => {
    expect(resolveProviderAvatarResolution({ id: 'modelrush', presetProviderId: 'modelrush' })).toEqual({
      kind: 'bundled',
      presetId: 'modelrush'
    })
  })

  it('preserves the saved logo for an unlinked colliding custom row', () => {
    expect(
      resolveProviderAvatarResolution({
        id: 'modelrush',
        logoSrc: 'file://uploaded-logo.png'
      })
    ).toEqual({ kind: 'custom', logo: 'file://uploaded-logo.png' })

    expect(
      resolveProviderAvatarResolution({
        id: 'modelrush',
        logo: 'icon:openai'
      })
    ).toEqual({ kind: 'custom', logo: 'icon:openai' })
  })

  it('never resolves the bundled icon via the raw id for unlinked rows without a logo', () => {
    expect(resolveProviderAvatarResolution({ id: 'modelrush' })).toEqual({
      kind: 'fallback-custom',
      sentinelId: 'custom:modelrush'
    })
  })

  it('resolves derived preset instances via the persisted preset id', () => {
    expect(resolveProviderAvatarResolution({ id: 'my-rush', presetProviderId: 'modelrush' })).toEqual({
      kind: 'bundled',
      presetId: 'modelrush'
    })
  })
})
