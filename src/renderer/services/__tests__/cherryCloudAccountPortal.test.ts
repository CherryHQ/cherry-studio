import { beforeEach, describe, expect, it, vi } from 'vitest'

import { openCherryCloudAccountPortal, openCherryCloudFaq } from '../cherryCloudAccountPortal'

const request = vi.mocked(window.api.ipcApi.request)

function useAccountOrigin(origin: string) {
  request.mockImplementation(async (route) =>
    route === 'cherry_cloud.account_origin.get' ? { ok: true, data: origin } : { ok: true, data: undefined }
  )
}

describe('openCherryCloudAccountPortal', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sends current scope and attribution through the trusted portal command', async () => {
    request.mockImplementation(async (route) =>
      route === 'cherry_cloud.status.get'
        ? { ok: true, data: { scopeId: 'account-scope' } }
        : { ok: true, data: { outcome: 'opened' } }
    )
    await openCherryCloudAccountPortal({ entrySource: 'quota_notice', flowId: '00000000-0000-4000-8000-000000000001' })
    expect(request).toHaveBeenCalledWith('cherry_cloud.account_portal.open', {
      scopeId: 'account-scope',
      entrySource: 'quota_notice',
      flowId: '00000000-0000-4000-8000-000000000001'
    })
  })
  it('preserves the login scope supplied by an asynchronous continuation', async () => {
    request.mockResolvedValue({ ok: true, data: { outcome: 'superseded' } })
    await expect(openCherryCloudAccountPortal({ scopeId: 'old' })).resolves.toEqual({ outcome: 'superseded' })
    expect(request).toHaveBeenCalledWith('cherry_cloud.account_portal.open', { scopeId: 'old' })
  })

  it('opens the official China-edition subscription FAQ', async () => {
    vi.stubGlobal('__APP_EDITION__', 'cn')
    useAccountOrigin('https://cloud-dev.cherry-ai.com')

    await openCherryCloudFaq()

    expect(request).toHaveBeenCalledWith(
      'system.shell.open_external_website',
      'https://cherryai.com.cn/subscription/faq'
    )
  })

  it('opens the global-edition FAQ on the same origin as the portal', async () => {
    vi.stubGlobal('__APP_EDITION__', 'global')
    useAccountOrigin('https://cloud.cherryai.com.cn')

    await openCherryCloudFaq()

    expect(request).toHaveBeenCalledWith(
      'system.shell.open_external_website',
      'https://cloud.cherryai.com.cn/account/faq?entry=desktop'
    )
  })
})
