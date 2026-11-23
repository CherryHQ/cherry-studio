import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AbsoluteFilePathSchema } from '@shared/types/file'

const { previewFileForInstallMock, confirmPendingInstallMock } = vi.hoisted(() => ({
  previewFileForInstallMock: vi.fn(),
  confirmPendingInstallMock: vi.fn()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

vi.mock('@main/features/miniApp/install/installFlow', () => ({
  cancelPending: vi.fn(),
  confirmPendingInstall: confirmPendingInstallMock,
  previewBuiltinForInstall: vi.fn(),
  previewFileForInstall: previewFileForInstallMock,
  previewUrlForInstall: vi.fn()
}))

import { application } from '@application'

import { miniAppHandlers } from '../miniApp'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('miniAppHandlers', () => {
  it('previews a dropped package for the trusted caller window', async () => {
    const filePath = AbsoluteFilePathSchema.parse('/tmp/example.miniapp')

    await miniAppHandlers['mini_app.install.preview_file']({ filePath }, { senderId: 'w1' })

    expect(previewFileForInstallMock).toHaveBeenCalledWith(filePath, 'w1')
  })

  it('reports each confirmed install outcome without the app identity, and still rejects a failure', async () => {
    confirmPendingInstallMock.mockResolvedValueOnce({ appId: 'private-app' })
    confirmPendingInstallMock.mockRejectedValueOnce(new Error('manifest changed'))
    const confirm = miniAppHandlers['mini_app.install.confirm']

    await confirm({ installToken: 't1' }, { senderId: 'w1' })
    await expect(confirm({ installToken: 't2' }, { senderId: 'w1' })).rejects.toThrow('manifest changed')

    expect(vi.mocked(application.get('AnalyticsService').trackProductEvent).mock.calls).toEqual([
      [{ event: 'feature_used', feature: 'mini_app', action: 'app_installed', status: 'success' }],
      [{ event: 'feature_used', feature: 'mini_app', action: 'app_installed', status: 'error' }]
    ])
  })
})
