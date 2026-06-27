import { beforeEach, describe, expect, it, vi } from 'vitest'

const { appGetMock, cleanupBySourceMock, createRefMock } = vi.hoisted(() => ({
  appGetMock: vi.fn(),
  cleanupBySourceMock: vi.fn(),
  createRefMock: vi.fn()
}))
vi.mock('@application', () => ({ application: { get: appGetMock } }))
vi.mock('@data/services/FileRefService', () => ({
  fileRefService: { cleanupBySource: cleanupBySourceMock, create: createRefMock }
}))

import { profileHandlers } from '../profile'

const FILE_ID = '019606a0-0000-7000-8000-000000000002'
const AVATAR_SLOT = { sourceType: 'user_avatar', sourceId: 'default' }

const preferences = { get: vi.fn(), set: vi.fn() }

beforeEach(() => {
  vi.clearAllMocks()
  appGetMock.mockImplementation((name: string) => {
    if (name === 'PreferenceService') return preferences
    throw new Error(`Unexpected application.get(${name})`)
  })
  preferences.set.mockResolvedValue(undefined)
  cleanupBySourceMock.mockResolvedValue(0)
  createRefMock.mockResolvedValue(undefined)
})

const ctx = { senderId: null }

describe('profileHandlers.set_avatar', () => {
  it('points the avatar slot ref at a pre-stored file and sets the preference', async () => {
    await profileHandlers['profile.set_avatar']({ kind: 'file', fileId: FILE_ID }, ctx)

    expect(cleanupBySourceMock).toHaveBeenCalledWith(AVATAR_SLOT)
    expect(createRefMock).toHaveBeenCalledWith({ fileEntryId: FILE_ID, ...AVATAR_SLOT, role: 'avatar' })
    expect(preferences.set).toHaveBeenCalledWith('app.user.avatar', FILE_ID)
  })

  it('clears the slot ref and stores an emoji value', async () => {
    await profileHandlers['profile.set_avatar']({ kind: 'value', value: '😀' }, ctx)

    expect(cleanupBySourceMock).toHaveBeenCalledWith(AVATAR_SLOT)
    expect(createRefMock).not.toHaveBeenCalled()
    expect(preferences.set).toHaveBeenCalledWith('app.user.avatar', '😀')
  })

  it('clears the slot ref and resets to empty', async () => {
    await profileHandlers['profile.set_avatar']({ kind: 'value', value: '' }, ctx)

    expect(cleanupBySourceMock).toHaveBeenCalledWith(AVATAR_SLOT)
    expect(createRefMock).not.toHaveBeenCalled()
    expect(preferences.set).toHaveBeenCalledWith('app.user.avatar', '')
  })
})
