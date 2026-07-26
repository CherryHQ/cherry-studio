import { describe, expect, it } from 'vitest'

import { getIconDisplayConfig } from '../iconDisplayConfig'

describe('getIconDisplayConfig', () => {
  it.each(['cherryin', 'aihubmix', 'lmstudio', 'anthropic', 'yi', 'groq', 'aws-bedrock'])(
    'contains the %s provider logo in the provider-list context',
    (providerId) => {
      expect(getIconDisplayConfig('provider-list', providerId)).toEqual({ scale: 5 / 7, borderRadius: 5 })
    }
  )

  it('enlarges mini-app icons outside the contained-icon list', () => {
    expect(getIconDisplayConfig('mini-app', 'lmstudio')).toEqual({ scale: 1.2 })
  })

  it('enlarges provider logos outside the contained-icon list', () => {
    expect(getIconDisplayConfig('provider-list', 'openai')).toEqual({ scale: 1.2 })
  })

  it('preserves the existing mini-app configuration', () => {
    expect(getIconDisplayConfig('mini-app', 'abacus')).toEqual({ scale: 5 / 7, borderRadius: 10 })
  })
})
