import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useMessageHeaderCapabilities } from '../useMessageHeaderCapabilities'

const mocks = vi.hoisted(() => ({
  dataApiGet: vi.fn(),
  loggerError: vi.fn(),
  openResourceEditor: vi.fn(),
  openUserProfile: vi.fn(),
  toastError: vi.fn()
}))

vi.mock('@data/DataApiService', () => ({
  dataApiService: {
    get: mocks.dataApiGet
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: mocks.loggerError
    })
  }
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

vi.mock('@renderer/services/toast', () => ({
  toast: {
    error: mocks.toastError
  }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

describe('useMessageHeaderCapabilities', () => {
  beforeEach(() => {
    mocks.dataApiGet.mockReset()
    mocks.loggerError.mockReset()
    mocks.openResourceEditor.mockReset()
    mocks.openResourceEditor.mockResolvedValue(undefined)
    mocks.openUserProfile.mockReset()
    mocks.openUserProfile.mockResolvedValue(undefined)
    mocks.toastError.mockReset()
  })

  it.each([
    ['assistant', 'assistant-1'],
    ['agent', 'agent-1']
  ] as const)('opens the %s editor for the requested message author', async (kind, id) => {
    const resource = { id, name: `${kind} name` }
    mocks.dataApiGet.mockResolvedValueOnce(resource)
    const { result } = renderHook(() => useMessageHeaderCapabilities(kind))

    await act(async () => {
      await result.current.openMessageAuthorEditor?.(id)
    })

    expect(mocks.dataApiGet).toHaveBeenCalledWith(`/${kind}s/${id}`)
    expect(mocks.openResourceEditor).toHaveBeenCalledWith({ kind, resource })
    expect(result.current.userProfile).toEqual({ avatar: '🙂' })
  })

  it.each(['assistant', 'agent'] as const)('does not create a popup when the %s cannot be loaded', async (kind) => {
    const error = new Error('Temporary load failure')
    mocks.dataApiGet.mockRejectedValueOnce(error)
    const { result } = renderHook(() => useMessageHeaderCapabilities(kind))

    await act(async () => {
      await result.current.openMessageAuthorEditor?.(`${kind}-1`)
    })

    expect(mocks.openResourceEditor).not.toHaveBeenCalled()
    expect(mocks.toastError).toHaveBeenCalledWith('common.error')
    expect(mocks.loggerError).toHaveBeenCalledWith(`Failed to load ${kind} for message author editor`, error, {
      id: `${kind}-1`
    })
  })

  it('keeps the existing user profile action', () => {
    const { result } = renderHook(() => useMessageHeaderCapabilities('assistant'))

    act(() => {
      void result.current.openUserProfile?.()
    })

    expect(mocks.openUserProfile).toHaveBeenCalledTimes(1)
  })
})
