import { describe, expect, it } from 'vitest'

import type { Provider } from '@shared/data/types/provider'
import { isProviderSupportAuth } from '@shared/utils/provider'

import { PROVIDER_SPECIFIC_SETTINGS_REGISTRY, type ProviderSpecificContext } from '../providerSpecificSettingsRegistry'

const showsAccountPanel = (provider: Pick<Provider, 'id' | 'apiKeys'>) => {
  const entry = PROVIDER_SPECIFIC_SETTINGS_REGISTRY.beforeAuth.find(({ key }) => key === 'oauth')!
  return entry.when({ provider } as ProviderSpecificContext)
}

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
