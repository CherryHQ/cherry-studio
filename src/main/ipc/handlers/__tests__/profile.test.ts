import { beforeEach, describe, expect, it, vi } from 'vitest'

const { appGetMock, createInternalEntryMock, permanentDeleteMock, transcodeMock } = vi.hoisted(() => ({
  appGetMock: vi.fn(),
  createInternalEntryMock: vi.fn(),
  permanentDeleteMock: vi.fn(),
  transcodeMock: vi.fn()
}))
vi.mock('@application', () => ({ application: { get: appGetMock } }))
vi.mock('@main/utils/image', () => ({ transcodeToEntityWebp: transcodeMock }))

import { profileHandlers } from '../profile'

const FILE_ID = '019606a0-0000-7000-8000-000000000002'
const WEBP = Buffer.from([1, 2, 3])

const preferences = { set: vi.fn() }
const fileManager = { createInternalEntry: createInternalEntryMock, permanentDelete: permanentDeleteMock }

beforeEach(() => {
  vi.clearAllMocks()
  appGetMock.mockImplementation((name: string) => {
    if (name === 'PreferenceService') return preferences
    if (name === 'FileManager') return fileManager
    throw new Error(`Unexpected application.get(${name})`)
  })
  preferences.set.mockResolvedValue(undefined)
  transcodeMock.mockResolvedValue(WEBP)
  createInternalEntryMock.mockResolvedValue({ id: FILE_ID })
  permanentDeleteMock.mockResolvedValue(undefined)
})

const ctx = { senderId: null }

describe('profileHandlers.set_avatar', () => {
  it('creates a file_entry from bytes and stores a file: ref in the preference', async () => {
    const data = new Uint8Array([9, 9, 9])
    await profileHandlers['profile.set_avatar']({ kind: 'image', data }, ctx)

    expect(transcodeMock).toHaveBeenCalledWith(data)
    expect(createInternalEntryMock).toHaveBeenCalledWith({
      source: 'bytes',
      data: WEBP,
      name: 'image',
      ext: 'webp',
      cleanupPolicy: 'manual'
    })
    expect(preferences.set).toHaveBeenCalledWith('app.user.avatar', `file:${FILE_ID}`)
    expect(permanentDeleteMock).not.toHaveBeenCalled()
  })

  it('compensates (permanentDelete) when the preference write fails', async () => {
    preferences.set.mockRejectedValueOnce(new Error('pref write failed'))

    await expect(
      profileHandlers['profile.set_avatar']({ kind: 'image', data: new Uint8Array([1]) }, ctx)
    ).rejects.toThrow('pref write failed')

    expect(permanentDeleteMock).toHaveBeenCalledWith(FILE_ID)
  })

  it('stores an emoji value verbatim (no file created)', async () => {
    await profileHandlers['profile.set_avatar']({ kind: 'emoji', emoji: '😀' }, ctx)

    expect(createInternalEntryMock).not.toHaveBeenCalled()
    expect(preferences.set).toHaveBeenCalledWith('app.user.avatar', '😀')
  })

  it('resets to empty on default (no file created)', async () => {
    await profileHandlers['profile.set_avatar']({ kind: 'default' }, ctx)

    expect(createInternalEntryMock).not.toHaveBeenCalled()
    expect(preferences.set).toHaveBeenCalledWith('app.user.avatar', '')
  })
})
