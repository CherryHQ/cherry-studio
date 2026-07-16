import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useMessageHeaderCapabilities } from '../useMessageHeaderCapabilities'

const mocks = vi.hoisted(() => ({
  openResourceEditor: vi.fn(),
  openUserProfile: vi.fn()
}))

vi.mock('@renderer/components/resourceCatalog/dialogs/edit', () => ({
  ResourceEditPopup: {
    show: mocks.openResourceEditor
  }
}))

vi.mock('@renderer/components/UserPopup', () => ({
  default: {
    show: mocks.openUserProfile
  }
}))

vi.mock('@renderer/hooks/useAvatar', () => ({
  default: () => '🙂'
}))

describe('useMessageHeaderCapabilities', () => {
  beforeEach(() => {
    mocks.openResourceEditor.mockReset()
    mocks.openResourceEditor.mockResolvedValue(undefined)
    mocks.openUserProfile.mockReset()
    mocks.openUserProfile.mockResolvedValue(undefined)
  })

  it.each([
    ['assistant', 'assistant-1'],
    ['agent', 'agent-1']
  ] as const)('opens the %s editor for the requested message author', async (kind, id) => {
    const { result } = renderHook(() => useMessageHeaderCapabilities(kind))

    await act(async () => {
      await result.current.openMessageAuthorEditor?.(id)
    })

    expect(mocks.openResourceEditor).toHaveBeenCalledWith({ target: { kind, id } })
    expect(result.current.userProfile).toEqual({ avatar: '🙂' })
  })

  it('keeps the existing user profile action', () => {
    const { result } = renderHook(() => useMessageHeaderCapabilities('assistant'))

    act(() => {
      void result.current.openUserProfile?.()
    })

    expect(mocks.openUserProfile).toHaveBeenCalledTimes(1)
  })
})
