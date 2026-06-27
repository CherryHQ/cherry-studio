import { beforeEach, describe, expect, it, vi } from 'vitest'

const { appGetMock, cleanupBySourceMock, createRefMock, createInternalEntryMock, permanentDeleteMock, transcodeMock } =
  vi.hoisted(() => ({
    appGetMock: vi.fn(),
    cleanupBySourceMock: vi.fn(),
    createRefMock: vi.fn(),
    createInternalEntryMock: vi.fn(),
    permanentDeleteMock: vi.fn(),
    transcodeMock: vi.fn()
  }))
vi.mock('@application', () => ({ application: { get: appGetMock } }))
vi.mock('@data/services/FileRefService', () => ({
  fileRefService: { cleanupBySource: cleanupBySourceMock, create: createRefMock }
}))
vi.mock('@main/services/file/utils/entityImageWebp', () => ({ transcodeToEntityWebp: transcodeMock }))

import { profileHandlers } from '../profile'

const FILE_ID = '019606a0-0000-7000-8000-000000000002'
const AVATAR_SLOT = { sourceType: 'user_avatar', sourceId: 'default' }
const WEBP = Buffer.from([1, 2, 3])

const preferences = { get: vi.fn(), set: vi.fn() }
const fileManager = { createInternalEntry: createInternalEntryMock, permanentDelete: permanentDeleteMock }

beforeEach(() => {
  vi.clearAllMocks()
  appGetMock.mockImplementation((name: string) => {
    if (name === 'PreferenceService') return preferences
    if (name === 'FileManager') return fileManager
    throw new Error(`Unexpected application.get(${name})`)
  })
  preferences.set.mockResolvedValue(undefined)
  cleanupBySourceMock.mockResolvedValue(0)
  createRefMock.mockResolvedValue(undefined)
  transcodeMock.mockResolvedValue(WEBP)
  createInternalEntryMock.mockResolvedValue({ id: FILE_ID })
  permanentDeleteMock.mockResolvedValue(undefined)
})

const ctx = { senderId: null }

describe('profileHandlers.set_avatar', () => {
  it('creates a file_entry from bytes, points the slot at it, and stores a file: ref', async () => {
    const data = new Uint8Array([9, 9, 9])
    await profileHandlers['profile.set_avatar']({ kind: 'image', data }, ctx)

    expect(transcodeMock).toHaveBeenCalledWith(data)
    expect(createInternalEntryMock).toHaveBeenCalledWith({ source: 'bytes', data: WEBP, name: 'image', ext: 'webp' })
    expect(cleanupBySourceMock).toHaveBeenCalledWith(AVATAR_SLOT)
    expect(createRefMock).toHaveBeenCalledWith({ fileEntryId: FILE_ID, ...AVATAR_SLOT, role: 'avatar' })
    expect(preferences.set).toHaveBeenCalledWith('app.user.avatar', `file:${FILE_ID}`)
    expect(permanentDeleteMock).not.toHaveBeenCalled()
  })

  it('compensates (permanentDelete) when the slot/preference write fails', async () => {
    preferences.set.mockRejectedValueOnce(new Error('pref write failed'))

    await expect(
      profileHandlers['profile.set_avatar']({ kind: 'image', data: new Uint8Array([1]) }, ctx)
    ).rejects.toThrow('pref write failed')

    expect(permanentDeleteMock).toHaveBeenCalledWith(FILE_ID)
  })

  it('clears the slot ref and stores an emoji value', async () => {
    await profileHandlers['profile.set_avatar']({ kind: 'emoji', emoji: '😀' }, ctx)

    expect(createInternalEntryMock).not.toHaveBeenCalled()
    expect(cleanupBySourceMock).toHaveBeenCalledWith(AVATAR_SLOT)
    expect(createRefMock).not.toHaveBeenCalled()
    expect(preferences.set).toHaveBeenCalledWith('app.user.avatar', '😀')
  })

  it('clears the slot ref and resets to empty', async () => {
    await profileHandlers['profile.set_avatar']({ kind: 'clear' }, ctx)

    expect(createInternalEntryMock).not.toHaveBeenCalled()
    expect(cleanupBySourceMock).toHaveBeenCalledWith(AVATAR_SLOT)
    expect(createRefMock).not.toHaveBeenCalled()
    expect(preferences.set).toHaveBeenCalledWith('app.user.avatar', '')
  })
})
