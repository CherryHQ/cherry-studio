import { beforeEach, describe, expect, it, vi } from 'vitest'

import { openSettingsTab } from '@renderer/services/mainWindowNavigation'
import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'

import { presentPaintingGenerationGuardFeedback } from '../presentPaintingGenerationGuardFeedback'

vi.mock('@renderer/i18n/resolver', () => ({
  default: { t: (key: string) => key }
}))
vi.mock('@renderer/services/toast', () => ({ toast: { error: vi.fn() } }))
vi.mock('@renderer/services/popup', () => ({ popup: { warning: vi.fn() } }))
vi.mock('@renderer/services/mainWindowNavigation', () => ({ openSettingsTab: vi.fn() }))

describe('presentPaintingGenerationGuardFeedback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reports a catalog failure with the translated model caption and the original cause', () => {
    const failure = new Error('catalog down')

    void presentPaintingGenerationGuardFeedback('catalog_error', failure, 'provider-1')

    expect(toast.error).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'paintings.req_error_model',
        cause: failure,
        data: expect.objectContaining({
          localizedErrorMessage: 'paintings.req_error_model',
          errorContext: expect.objectContaining({
            message: 'catalog down',
            source: 'paintings',
            operation: 'painting.catalog',
            providerId: 'provider-1'
          })
        })
      })
    )
    expect(toast.error).not.toHaveBeenCalledWith('catalog down')
    expect(openSettingsTab).not.toHaveBeenCalled()
  })

  it('keeps model-unavailable and missing-model captions without a raw cause', () => {
    void presentPaintingGenerationGuardFeedback('model_unavailable')
    void presentPaintingGenerationGuardFeedback('model_missing')

    expect(toast.error).toHaveBeenNthCalledWith(1, 'paintings.req_error_model')
    expect(toast.error).toHaveBeenNthCalledWith(2, 'paintings.select_model')
  })

  it('still offers settings when the provider is disabled', async () => {
    vi.mocked(popup.warning).mockResolvedValue(true)

    await presentPaintingGenerationGuardFeedback('provider_disabled', undefined, 'provider-1')

    expect(popup.warning).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'error.provider_disabled', okText: 'common.go_to_settings' })
    )
    expect(openSettingsTab).toHaveBeenCalledWith('/settings/provider?id=provider-1')
    expect(toast.error).not.toHaveBeenCalled()
  })
})
