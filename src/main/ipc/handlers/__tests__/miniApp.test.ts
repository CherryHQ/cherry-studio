import { AbsoluteFilePathSchema } from '@shared/types/file'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { previewFileForInstallMock } = vi.hoisted(() => ({
  previewFileForInstallMock: vi.fn()
}))

vi.mock('@main/features/miniApp/install/installFlow', () => ({
  cancelPending: vi.fn(),
  confirmPendingInstall: vi.fn(),
  previewBuiltinForInstall: vi.fn(),
  previewFileForInstall: previewFileForInstallMock,
  previewUrlForInstall: vi.fn()
}))

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
})
