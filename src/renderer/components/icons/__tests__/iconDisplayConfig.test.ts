import { describe, expect, it } from 'vitest'

import { resolveProviderIconRef } from '@cherrystudio/ui/icons'

import { getIconDisplayConfig } from '../iconDisplayConfig'
import { getMiniAppsLogoRef } from '../miniAppsLogo'

describe('getIconDisplayConfig', () => {
  it.each([
    'cherryin',
    'aihubmix',
    'lmstudio',
    'anthropic',
    'yi',
    'groq',
    'aws-bedrock',
    'tokendance',
    'litellm',
    'radeon-cloud'
  ])('contains the %s provider logo in the provider-list context', (providerId) => {
    const icon = resolveProviderIconRef(providerId)
    expect(icon).toBeDefined()
    expect(getIconDisplayConfig('provider-list', icon?.meta.id)).toEqual({ scale: 5 / 7, borderRadius: 5 })
  })

  it('enlarges mini-app icons outside the contained-icon list', () => {
    expect(getIconDisplayConfig('mini-app', 'lmstudio')).toEqual({ scale: 1.2 })
  })

  it('enlarges provider logos outside the contained-icon list', () => {
    expect(getIconDisplayConfig('provider-list', 'openai')).toEqual({ scale: 1.2 })
  })

  it('preserves the existing mini-app configuration', () => {
    expect(getIconDisplayConfig('mini-app', 'abacus')).toEqual({ scale: 5 / 7, borderRadius: 10 })
  })

  it.each(['coze-cn', 'minimax-agent-cn', 'minimax', 'zeroone', 'mintop3', '3mintop', 'claude'])(
    'contains the resolved %s mini-app artwork',
    (logo) => {
      expect(getIconDisplayConfig('mini-app', getMiniAppsLogoRef(logo)?.meta.id)).toEqual({
        scale: 5 / 7,
        borderRadius: 10
      })
    }
  )

  it.each(['canva', 'gamma', 'napkin'])('crops the inset %s bitmap before sizing and rounding it', (logo) => {
    expect(getIconDisplayConfig('mini-app', logo)).toEqual({
      scale: 5 / 7,
      borderRadius: 10,
      viewBox: '27.5 27.5 65 65'
    })
  })
})
