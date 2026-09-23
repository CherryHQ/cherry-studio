import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const { openSettingsTab } = vi.hoisted(() => ({
  openSettingsTab: vi.fn()
}))

vi.mock('@renderer/services/mainWindowNavigation', () => ({
  openSettingsTab
}))

vi.mock('@renderer/hooks/useAvatar', () => ({
  default: () => 'file:///tmp/avatar.png'
}))

import { useMessageHeaderCapabilities } from '../useMessageHeaderCapabilities'

describe('useMessageHeaderCapabilities', () => {
  it('opens the personal information settings page from a conversation avatar', () => {
    const { result } = renderHook(() => useMessageHeaderCapabilities())

    void result.current.openUserProfile?.()

    expect(openSettingsTab).toHaveBeenCalledWith('/settings/profile')
  })
})
