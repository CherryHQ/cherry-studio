/**
 * Behavior tests for `getProviderDisplayName`.
 *
 * The invariant the selector depends on: when multiple derived providers
 * inherit from the same preset (e.g. two `openai`-based custom providers),
 * each must render its user-chosen name — not all collapse to the preset
 * label. This is the specific regression the function was written to
 * prevent.
 */

import type { Provider } from '@shared/data/types/provider'
import { describe, expect, it, vi } from 'vitest'

import { getProviderDisplayName } from '../utils'

vi.mock('@renderer/i18n/label', () => ({
  getProviderLabel: (id: string) => `Label(${id})`
}))

function makeProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 'openai',
    presetProviderId: 'openai',
    name: 'My OpenAI',
    apiHost: 'https://api.openai.com',
    apiKey: '',
    models: [],
    isEnabled: true,
    isSystem: false,
    type: 'openai',
    ...overrides
  } as unknown as Provider
}

describe('getProviderDisplayName', () => {
  it('returns the localized label for canonical preset providers (id === presetProviderId)', () => {
    const provider = makeProvider({ id: 'openai', presetProviderId: 'openai', name: 'My OpenAI' })

    expect(getProviderDisplayName(provider)).toBe('Label(openai)')
  })

  it('returns the user-set name for derived providers (id !== presetProviderId)', () => {
    const provider = makeProvider({ id: 'openai-work', presetProviderId: 'openai', name: 'OpenAI Work' })

    expect(getProviderDisplayName(provider)).toBe('OpenAI Work')
  })

  it('keeps multiple derived providers visually distinct instead of collapsing to the preset label', () => {
    const workspace = makeProvider({ id: 'openai-work', presetProviderId: 'openai', name: 'OpenAI Work' })
    const personal = makeProvider({ id: 'openai-personal', presetProviderId: 'openai', name: 'OpenAI Personal' })

    expect(getProviderDisplayName(workspace)).toBe('OpenAI Work')
    expect(getProviderDisplayName(personal)).toBe('OpenAI Personal')
  })

  it('returns the user-set name for fully custom providers without a presetProviderId', () => {
    const provider = makeProvider({ id: 'my-local', presetProviderId: undefined, name: 'My Local LLM' })

    expect(getProviderDisplayName(provider)).toBe('My Local LLM')
  })
})
