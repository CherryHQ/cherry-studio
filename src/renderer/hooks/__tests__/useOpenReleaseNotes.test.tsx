// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ipcRequest: vi.fn(),
  openSmartMiniApp: vi.fn(),
  theme: 'light'
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: (...args: unknown[]) => mocks.ipcRequest(...args) }
}))

vi.mock('@renderer/hooks/useMiniAppPopup', () => ({
  useMiniAppPopup: () => ({ openSmartMiniApp: mocks.openSmartMiniApp })
}))

vi.mock('@renderer/hooks/useTheme', () => ({
  useTheme: () => ({ theme: mocks.theme })
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

import { useOpenReleaseNotes } from '../useOpenReleaseNotes'

describe('useOpenReleaseNotes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.theme = 'light'
    mocks.ipcRequest.mockResolvedValue({ appPath: '/Applications/Cherry Studio.app/Contents' })
  })

  it.each([
    ['light', 'light'],
    ['dark', 'dark']
  ])('opens the bundled Releases mini-app in %s mode', async (theme, expectedTheme) => {
    mocks.theme = theme
    const { result } = renderHook(() => useOpenReleaseNotes())

    await act(() => result.current())

    expect(mocks.ipcRequest).toHaveBeenCalledWith('app.get_info')
    expect(mocks.openSmartMiniApp).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: 'cherrystudio-releases',
        name: 'settings.about.releases.title',
        url: `file:///Applications/Cherry Studio.app/Contents/resources/cherry-studio/releases.html?theme=${expectedTheme}`
      })
    )
  })
})
