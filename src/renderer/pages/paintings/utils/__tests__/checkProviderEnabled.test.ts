import { openSettingsTab } from '@renderer/services/mainWindowNavigation'
import { popup } from '@renderer/services/popup'
import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PaintingProviderRuntime } from '../../model/types/paintingProviderRuntime'
import { checkProviderEnabled, isNoAuthProvider } from '../checkProviderEnabled'

vi.mock('@renderer/services/popup', () => ({ popup: { warning: vi.fn() } }))
vi.mock('@renderer/services/mainWindowNavigation', () => ({ openSettingsTab: vi.fn() }))
vi.mock('i18next', () => ({ default: { t: (key: string) => key } }))

function runtimeProvider(overrides: Partial<PaintingProviderRuntime> = {}): PaintingProviderRuntime {
  return {
    id: 'zhipu',
    name: 'Zhipu',
    apiHost: 'https://example.com',
    isEnabled: true,
    getApiKey: vi.fn(async () => 'token'),
    ...overrides
  }
}

describe('isNoAuthProvider', () => {
  it('matches by id', () => {
    expect(isNoAuthProvider({ id: 'ollama' })).toBe(true)
    expect(isNoAuthProvider({ id: 'ovms' })).toBe(true)
    expect(isNoAuthProvider({ id: 'zhipu' })).toBe(false)
  })

  it('matches a copied provider via presetProviderId when the id itself does not match', () => {
    expect(isNoAuthProvider({ id: 'ollama-2', presetProviderId: 'ollama' })).toBe(true)
    expect(isNoAuthProvider({ id: 'custom', presetProviderId: 'zhipu' })).toBe(false)
  })

  it('matches an endpoint-only Ollama provider (Provider editor / deep link, no matching id or presetProviderId) via defaultChatEndpoint', () => {
    expect(isNoAuthProvider({ id: 'custom-local', defaultChatEndpoint: ENDPOINT_TYPE.OLLAMA_CHAT })).toBe(true)
    expect(isNoAuthProvider({ id: 'custom-local', defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS })).toBe(
      false
    )
  })
})

describe('checkProviderEnabled', () => {
  beforeEach(() => {
    vi.mocked(popup.warning).mockReset()
    vi.mocked(openSettingsTab).mockReset()
  })

  it.each(['ollama', 'ovms'] as const)(
    'blocks a disabled no-auth provider (%s) — being keyless does not exempt the enabled check',
    async (id) => {
      vi.mocked(popup.warning).mockResolvedValue(false)
      const provider = runtimeProvider({ id, isEnabled: false, getApiKey: vi.fn(async () => '') })

      await expect(checkProviderEnabled(provider)).rejects.toBe('Provider disabled')
      expect(provider.getApiKey).not.toHaveBeenCalled()
    }
  )

  it('returns an empty key for an enabled no-auth provider without prompting for an API key', async () => {
    const provider = runtimeProvider({ id: 'ollama', isEnabled: true, getApiKey: vi.fn(async () => '') })

    await expect(checkProviderEnabled(provider)).resolves.toBe('')
    expect(provider.getApiKey).not.toHaveBeenCalled()
  })

  it('returns an empty key for an enabled provider matched only via presetProviderId (a copied Ollama entry)', async () => {
    const provider = runtimeProvider({
      id: 'ollama-2',
      presetProviderId: 'ollama',
      isEnabled: true,
      getApiKey: vi.fn(async () => '')
    })

    await expect(checkProviderEnabled(provider)).resolves.toBe('')
    expect(provider.getApiKey).not.toHaveBeenCalled()
  })

  it('blocks a disabled provider matched only via presetProviderId — keyless status does not exempt the enabled check', async () => {
    vi.mocked(popup.warning).mockResolvedValue(false)
    const provider = runtimeProvider({ id: 'ollama-2', presetProviderId: 'ollama', isEnabled: false })

    await expect(checkProviderEnabled(provider)).rejects.toBe('Provider disabled')
  })

  it('returns an empty key for an enabled endpoint-only Ollama provider (Provider editor / deep link) without prompting for an API key', async () => {
    const provider = runtimeProvider({
      id: 'custom-local',
      defaultChatEndpoint: ENDPOINT_TYPE.OLLAMA_CHAT,
      isEnabled: true,
      getApiKey: vi.fn(async () => '')
    })

    await expect(checkProviderEnabled(provider)).resolves.toBe('')
    expect(provider.getApiKey).not.toHaveBeenCalled()
  })

  it('blocks a disabled endpoint-only Ollama provider — keyless status does not exempt the enabled check', async () => {
    vi.mocked(popup.warning).mockResolvedValue(false)
    const provider = runtimeProvider({
      id: 'custom-local',
      defaultChatEndpoint: ENDPOINT_TYPE.OLLAMA_CHAT,
      isEnabled: false
    })

    await expect(checkProviderEnabled(provider)).rejects.toBe('Provider disabled')
  })

  it('blocks a disabled provider that requires auth', async () => {
    vi.mocked(popup.warning).mockResolvedValue(false)
    const provider = runtimeProvider({ isEnabled: false })

    await expect(checkProviderEnabled(provider)).rejects.toBe('Provider disabled')
  })

  it('blocks an enabled provider that requires auth but has no API key', async () => {
    vi.mocked(popup.warning).mockResolvedValue(false)
    const provider = runtimeProvider({ getApiKey: vi.fn(async () => '') })

    await expect(checkProviderEnabled(provider)).rejects.toBe('No API key')
  })

  it('returns the API key for an enabled provider that requires auth and has one', async () => {
    const provider = runtimeProvider({ getApiKey: vi.fn(async () => 'sk-real') })

    await expect(checkProviderEnabled(provider)).resolves.toBe('sk-real')
  })
})
