import { beforeEach, describe, expect, it, vi } from 'vitest'

import { cacheService } from '@data/CacheService'
import i18n from '@renderer/i18n/resolver'
import { toast } from '@renderer/services/toast'
import { cherryCloudErrorCodes } from '@shared/ipc/errors/cherryCloud'

import { startCherryCloudSubscription } from '../cherryCloudSubscription'

const request = vi.mocked(window.api.ipcApi.request)

beforeEach(() => {
  vi.clearAllMocks()
  request.mockResolvedValue({ ok: true, data: undefined })
})

describe('startCherryCloudSubscription', () => {
  it('sends one command with click attribution and dismisses the Subscribe dot', async () => {
    await startCherryCloudSubscription('selector_locked_row', { modelId: 'cloud-model' })

    expect(cacheService.getPersist('ui.cherry_cloud.subscribe_prompt_seen')).toBe(true)
    expect(request.mock.calls).toEqual([
      [
        'cherry_cloud.subscription.start',
        {
          source: 'selector_locked_row',
          flowId: expect.any(String),
          modelId: 'cloud-model'
        }
      ]
    ])
  })

  it('leaves overlapping clicks to the Main owner instead of managing window intents', async () => {
    const completion = Promise.withResolvers<{ ok: true; data: undefined }>()
    request.mockReturnValue(completion.promise)
    const first = startCherryCloudSubscription('settings')
    const second = startCherryCloudSubscription('account_panel')
    const inputs = request.mock.calls.map(([, input]) => input)

    expect(inputs).toEqual([
      { source: 'settings', flowId: expect.any(String) },
      { source: 'account_panel', flowId: expect.any(String) }
    ])
    expect(inputs[0]).not.toEqual(inputs[1])
    completion.resolve({ ok: true, data: undefined })
    await Promise.all([first, second])
    expect(toast.error).not.toHaveBeenCalled()
  })

  it.each([
    [cherryCloudErrorCodes.UPGRADE_REQUIRED, 'settings.provider.cherry_cloud.upgrade_required'],
    [cherryCloudErrorCodes.LOGIN_SERVICE_UNAVAILABLE, 'error.http.503'],
    [cherryCloudErrorCodes.PORTAL_OPEN_FAILED, 'settings.subscription.open_portal_failed'],
    ['INTERNAL_ERROR', 'settings.provider.cherry_cloud.sign_in_failed']
  ])('shows the existing localized error for %s', async (code, title) => {
    request.mockResolvedValue({ ok: false, error: { code, message: 'request failed' } })

    await expect(startCherryCloudSubscription('settings')).resolves.toBeUndefined()

    expect(toast.error).toHaveBeenCalledWith({ key: 'cherry-cloud-subscription', title: i18n.t(title) })
  })
})
