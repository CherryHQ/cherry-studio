import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  edition: 'global' as 'cn' | 'global',
  openSettingsTab: vi.fn(),
  showUserPopup: vi.fn()
}))

vi.mock('@renderer/services/mainWindowNavigation', () => ({
  openSettingsTab: mocks.openSettingsTab
}))

vi.mock('@renderer/components/UserPopup', () => ({
  default: { show: mocks.showUserPopup }
}))

vi.mock('@renderer/utils/appEdition', () => ({
  getAppEdition: () => mocks.edition
}))

vi.mock('@renderer/hooks/useAvatar', () => ({
  default: () => 'file:///tmp/avatar.png'
}))

import { useMessageHeaderCapabilities } from '../useMessageHeaderCapabilities'

describe('useMessageHeaderCapabilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.edition = 'global'
  })

  it('opens personal information from a global-edition conversation avatar', () => {
    const { result } = renderHook(() => useMessageHeaderCapabilities())

    void result.current.openUserProfile?.()

    expect(mocks.openSettingsTab).toHaveBeenCalledWith('/settings/profile')
    expect(mocks.showUserPopup).not.toHaveBeenCalled()
  })

  it('opens the account popup from a CN-edition conversation avatar', () => {
    mocks.edition = 'cn'
    const { result } = renderHook(() => useMessageHeaderCapabilities())

    void result.current.openUserProfile?.()

    expect(mocks.showUserPopup).toHaveBeenCalled()
    expect(mocks.openSettingsTab).not.toHaveBeenCalled()
  })
})
