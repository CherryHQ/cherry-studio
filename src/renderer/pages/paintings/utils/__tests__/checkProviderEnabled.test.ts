import { openSettingsTab } from '@renderer/services/mainWindowNavigation'
import { popup } from '@renderer/services/popup'
import { PaintingGenerateError } from '@shared/ai/paintingGenerateError'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PaintingProviderRuntime } from '../../model/types/paintingProviderRuntime'
import { checkProviderEnabled } from '../checkProviderEnabled'

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

describe('checkProviderEnabled', () => {
  beforeEach(() => {
    vi.mocked(popup.warning).mockReset()
    vi.mocked(openSettingsTab).mockReset()
  })

  /**
   * A typed, silently-presented error — not a bare string. `runPainting` only
   * normalizes values passing `instanceof Error`, so a string escaped unwrapped and
   * `usePaintingGeneration` reported it a second time as a generic "generate failed"
   * modal stacked on top of the dialog below. `'silent'` marks the dialog (with its
   * go-to-settings action) as the presentation.
   */
  function expectProviderDisabled(error: unknown) {
    expect(error).toBeInstanceOf(PaintingGenerateError)
    expect((error as PaintingGenerateError).code).toBe('PROVIDER_DISABLED')
    expect((error as PaintingGenerateError).presentation).toBe('silent')
  }

  it('blocks a disabled provider, offering to navigate to settings', async () => {
    vi.mocked(popup.warning).mockResolvedValue(true)
    const provider = runtimeProvider({ isEnabled: false })

    await checkProviderEnabled(provider).then(
      () => expect.unreachable('a disabled provider must reject'),
      expectProviderDisabled
    )
    expect(openSettingsTab).toHaveBeenCalledWith(`/settings/provider?id=${provider.id}`)
  })

  it('does not navigate to settings when the disabled-provider prompt is dismissed', async () => {
    vi.mocked(popup.warning).mockResolvedValue(false)
    const provider = runtimeProvider({ isEnabled: false })

    await checkProviderEnabled(provider).then(
      () => expect.unreachable('a disabled provider must reject'),
      expectProviderDisabled
    )
    expect(openSettingsTab).not.toHaveBeenCalled()
  })

  it('is keyless-permissive: returns an empty key for an enabled provider with none, without prompting', async () => {
    const provider = runtimeProvider({ getApiKey: vi.fn(async () => '') })

    await expect(checkProviderEnabled(provider)).resolves.toBe('')
    expect(popup.warning).not.toHaveBeenCalled()
  })

  it('returns the API key for an enabled provider that has one', async () => {
    const provider = runtimeProvider({ getApiKey: vi.fn(async () => 'sk-real') })

    await expect(checkProviderEnabled(provider)).resolves.toBe('sk-real')
  })
})
