import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'

import type { Provider } from '@shared/data/types/provider'
import { isProviderSupportAuth } from '@shared/utils/provider'

import { PROVIDER_SPECIFIC_SETTINGS_REGISTRY, type ProviderSpecificContext } from '../providerSpecificSettingsRegistry'

const showsAccountPanel = (provider: Pick<Provider, 'id' | 'apiKeys'>) => {
  const entry = PROVIDER_SPECIFIC_SETTINGS_REGISTRY.beforeAuth.find(({ key }) => key === 'oauth')!
  return entry.when({ provider } as ProviderSpecificContext)
}

const findCodexOauthEntry = () => PROVIDER_SPECIFIC_SETTINGS_REGISTRY.beforeAuth.find((e) => e.key === 'codex-oauth')!

const showsCodexOauth = (provider: Pick<Provider, 'id' | 'presetProviderId'>) =>
  findCodexOauthEntry().when({ provider } as ProviderSpecificContext)

describe('API key provider account panels', () => {
  it('requires manual SiliconFlow credentials and retains billing after a key is enabled', () => {
    expect(isProviderSupportAuth({ id: 'silicon' })).toBe(false)
    expect(showsAccountPanel({ id: 'silicon', apiKeys: [] })).toBe(false)
    expect(showsAccountPanel({ id: 'silicon', apiKeys: [{ id: 'manual-key', isEnabled: true }] })).toBe(true)
    expect(showsAccountPanel({ id: 'silicon', apiKeys: [{ id: 'disabled-key', isEnabled: false }] })).toBe(false)
  })

  it.each(['302ai', 'aihubmix', 'ppio', 'aionly', 'tokendance'])('keeps key acquisition available for %s', (id) => {
    expect(isProviderSupportAuth({ id })).toBe(true)
    expect(showsAccountPanel({ id, apiKeys: [] })).toBe(true)
  })
})

describe('Codex OAuth settings gate', () => {
  it('matches a preset-derived Codex instance with a UUID id', () => {
    expect(showsCodexOauth({ id: '7bf2a1d4-6c3e-4f0a-9c2d-5e8b1f3a4c5d', presetProviderId: 'openai-codex' })).toBe(true)
  })

  it('does not match a provider without the Codex preset', () => {
    expect(showsCodexOauth({ id: 'custom-provider' })).toBe(false)
  })

  it('does not grab other OAuth presets such as grok-cli', () => {
    expect(showsCodexOauth({ id: '0a1b2c3d-4e5f-6789-abcd-ef0123456789', presetProviderId: 'grok-cli' })).toBe(false)
  })

  it('renders the account-aware login panel for the provider row', () => {
    const providerId = '7bf2a1d4-6c3e-4f0a-9c2d-5e8b1f3a4c5d'
    const element = findCodexOauthEntry().render(providerId) as ReactElement<{
      providerId?: string
      showAccountId?: boolean
    }>
    expect(element.props).toMatchObject({ providerId, showAccountId: true })
  })
})
