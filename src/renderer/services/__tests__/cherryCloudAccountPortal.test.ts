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

  it.each([
    ['https://cloud.cherryai.com.cn', 'https://cloud.cherryai.com.cn/account/plans'],
    ['https://cloud.cherryai.com', 'https://cloud.cherryai.com/account/plans'],
    ['http://192.168.1.176:8284', 'http://192.168.1.176:8284/account/plans']
  ])('opens the portal on the %s account center', async (accountOrigin, portalUrl) => {
    useAccountOrigin(accountOrigin)

    await openCherryCloudAccountPortal()

    expect(request).toHaveBeenCalledWith('system.shell.open_external_website', `${portalUrl}?entry=desktop`)
  })

  it('tells the portal which touchpoint and subscription flow the visit came from', async () => {
    useAccountOrigin('https://cloud.cherryai.com.cn')

    await openCherryCloudAccountPortal({ entrySource: 'quota_notice', flowId: 'f1' })

    expect(request).toHaveBeenCalledWith(
      'system.shell.open_external_website',
      'https://cloud.cherryai.com.cn/account/plans?entry=desktop&entry_source=quota_notice&flow_id=f1'
    )
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
