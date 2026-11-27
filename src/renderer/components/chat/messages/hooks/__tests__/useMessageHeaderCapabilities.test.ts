import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  openSettingsTab: vi.fn()
}))

vi.mock('@renderer/services/mainWindowNavigation', () => ({
  openSettingsTab: mocks.openSettingsTab
}))

vi.mock('@renderer/hooks/useAvatar', () => ({
  default: () => 'file:///tmp/avatar.png'
}))

import { useMessageHeaderCapabilities } from '../useMessageHeaderCapabilities'

describe('useMessageHeaderCapabilities', () => {
  it('opens personal information from a conversation avatar', () => {
    const { result } = renderHook(() => useMessageHeaderCapabilities())

    void result.current.openUserProfile?.()

    expect(mocks.openSettingsTab).toHaveBeenCalledWith('/settings/profile')
  })
})
