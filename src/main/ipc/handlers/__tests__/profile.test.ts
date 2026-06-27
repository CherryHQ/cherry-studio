import { beforeEach, describe, expect, it, vi } from 'vitest'

const { appGetMock, storeEntityImageMock, deleteEntityImageMock } = vi.hoisted(() => ({
  appGetMock: vi.fn(),
  storeEntityImageMock: vi.fn(),
  deleteEntityImageMock: vi.fn()
}))
vi.mock('@application', () => ({ application: { get: appGetMock } }))
vi.mock('@main/services/file/entityImageFile', () => ({
  storeEntityImage: storeEntityImageMock,
  deleteEntityImage: deleteEntityImageMock
}))

import { profileHandlers } from '../profile'

const STORED_ID = '019606a0-0000-7000-8000-000000000001'
const NEW_ID = '019606a0-0000-7000-8000-000000000002'

const preferences = {
  get: vi.fn(),
  set: vi.fn()
}

beforeEach(() => {
  vi.clearAllMocks()
  appGetMock.mockImplementation((name: string) => {
    if (name === 'PreferenceService') return preferences
    throw new Error(`Unexpected application.get(${name})`)
  })
  preferences.set.mockResolvedValue(undefined)
  deleteEntityImageMock.mockResolvedValue(undefined)
})

const ctx = { senderId: null }

describe('profileHandlers.set_avatar', () => {
  it('stores an uploaded image, sets the preference, and prunes the previous stored file', async () => {
    preferences.get.mockReturnValue(STORED_ID)
    storeEntityImageMock.mockResolvedValue(NEW_ID)
    const data = new Uint8Array([1, 2, 3])

    await profileHandlers['profile.set_avatar']({ kind: 'image', data }, ctx)

    expect(storeEntityImageMock).toHaveBeenCalledWith(data, 'user_avatar')
    expect(preferences.set).toHaveBeenCalledWith('app.user.avatar', NEW_ID)
    expect(deleteEntityImageMock).toHaveBeenCalledWith(STORED_ID)
  })

  it('sets an emoji/value and prunes the previous stored file', async () => {
    preferences.get.mockReturnValue(STORED_ID)

    await profileHandlers['profile.set_avatar']({ kind: 'value', value: '😀' }, ctx)

    expect(storeEntityImageMock).not.toHaveBeenCalled()
    expect(preferences.set).toHaveBeenCalledWith('app.user.avatar', '😀')
    expect(deleteEntityImageMock).toHaveBeenCalledWith(STORED_ID)
  })

  it('does not prune when the previous value was not a stored file id (emoji / empty)', async () => {
    preferences.get.mockReturnValue('🐶')

    await profileHandlers['profile.set_avatar']({ kind: 'value', value: '' }, ctx)

    expect(preferences.set).toHaveBeenCalledWith('app.user.avatar', '')
    expect(deleteEntityImageMock).toHaveBeenCalledWith(null)
  })
})
