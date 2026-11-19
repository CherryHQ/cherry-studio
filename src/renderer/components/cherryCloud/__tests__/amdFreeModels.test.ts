import { beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@renderer/i18n/resolver'
import { toast } from '@renderer/services/toast'
import { cherryCloudErrorCodes } from '@shared/ipc/errors/cherryCloud'

import { getAmdActionLabelKey, openAmdRegistration } from '../amdFreeModels'

const request = vi.mocked(window.api.ipcApi.request)

beforeEach(() => {
  vi.clearAllMocks()
  request.mockResolvedValue({ ok: true, data: undefined })
})

describe('openAmdRegistration', () => {
  it('leaves sign-in and the entry link to Main instead of opening a page itself', async () => {
    await openAmdRegistration('qwen3-8-27b')

    expect(request.mock.calls.map(([route]) => route)).toEqual([
      'cherry_cloud.analytics.track',
      'cherry_cloud.amd_entry.open'
    ])
    expect(toast.error).not.toHaveBeenCalled()
  })

  it.each([
    [cherryCloudErrorCodes.AMD_ENTRY_FAILED, 'models.amd_free.open_failed'],
    [cherryCloudErrorCodes.LOGIN_SERVICE_UNAVAILABLE, 'error.http.503'],
    ['INTERNAL_ERROR', 'settings.provider.cherry_cloud.sign_in_failed']
  ])('tells the user why the AMD page did not open: %s', async (code, title) => {
    request.mockImplementation(async (route: string) =>
      route === 'cherry_cloud.amd_entry.open'
        ? { ok: false, error: { code, message: 'request failed' } }
        : { ok: true, data: undefined }
    )

    await expect(openAmdRegistration('qwen3-8-27b')).resolves.toBeUndefined()

    expect(toast.error).toHaveBeenCalledWith({ key: 'cherry-cloud-amd-entry', title: i18n.t(title) })
  })
})

describe('getAmdActionLabelKey', () => {
  const status = (action: string, state = 'unregistered') => ({ status: state, action, activated: false })

  it.each([
    [status('register'), 'models.amd_free.action.register'],
    // With registration closed the server asks to link, so the row never offers a new registration.
    [status('login', 'existing_account'), 'models.amd_free.action.link'],
    [status('login', 'credential_invalid'), 'models.amd_free.action.reverify'],
    [status('continue', 'pending'), 'models.amd_free.action.continue'],
    [status('wait', 'pending'), 'models.amd_free.action.wait'],
    [status('contact_support', 'needs_review'), 'models.amd_free.action.contact_support'],
    [undefined, 'models.amd_free.tag'],
    [status('something-new'), 'models.amd_free.tag']
  ])('names the next AMD step for %o', (value, key) => {
    expect(getAmdActionLabelKey(value)).toBe(key)
  })
})
