import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  appGetMock,
  cleanupBySourceTxMock,
  createTxMock,
  setTxMock,
  withWriteTxMock,
  createInternalEntryMock,
  permanentDeleteMock,
  transcodeMock
} = vi.hoisted(() => ({
  appGetMock: vi.fn(),
  cleanupBySourceTxMock: vi.fn(),
  createTxMock: vi.fn(),
  setTxMock: vi.fn(),
  withWriteTxMock: vi.fn(),
  createInternalEntryMock: vi.fn(),
  permanentDeleteMock: vi.fn(),
  transcodeMock: vi.fn()
}))
vi.mock('@application', () => ({ application: { get: appGetMock } }))
vi.mock('@data/services/FileRefService', () => ({
  fileRefService: { cleanupBySourceTx: cleanupBySourceTxMock, createTx: createTxMock }
}))
vi.mock('@main/services/file/utils/entityImageWebp', () => ({ transcodeToEntityWebp: transcodeMock }))

import { profileHandlers } from '../profile'

const FILE_ID = '019606a0-0000-7000-8000-000000000002'
const AVATAR_SLOT = { sourceType: 'user_avatar', sourceId: 'default' }
const WEBP = Buffer.from([1, 2, 3])
// Sentinel tx object handed to the tx-scoped methods (which are all mocked).
const TX = { __tx: true }

const preferences = { setTx: setTxMock }
// withWriteTx runs the caller's fn with the sentinel tx and returns its result.
const dbService = { withWriteTx: withWriteTxMock }
const fileManager = { createInternalEntry: createInternalEntryMock, permanentDelete: permanentDeleteMock }
// The post-commit callback set_avatar must run after the tx commits.
const afterCommit = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  appGetMock.mockImplementation((name: string) => {
    if (name === 'PreferenceService') return preferences
    if (name === 'DbService') return dbService
    if (name === 'FileManager') return fileManager
    throw new Error(`Unexpected application.get(${name})`)
  })
  withWriteTxMock.mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(TX))
  cleanupBySourceTxMock.mockResolvedValue(0)
  createTxMock.mockResolvedValue(undefined)
  afterCommit.mockResolvedValue(undefined)
  setTxMock.mockResolvedValue(afterCommit)
  transcodeMock.mockResolvedValue(WEBP)
  createInternalEntryMock.mockResolvedValue({ id: FILE_ID })
  permanentDeleteMock.mockResolvedValue(undefined)
})

const ctx = { senderId: null }

describe('profileHandlers.set_avatar', () => {
  it('binds the slot and writes the preference in one tx, then runs the post-commit callback', async () => {
    const data = new Uint8Array([9, 9, 9])
    await profileHandlers['profile.set_avatar']({ kind: 'image', data }, ctx)

    expect(transcodeMock).toHaveBeenCalledWith(data)
    expect(createInternalEntryMock).toHaveBeenCalledWith({ source: 'bytes', data: WEBP, name: 'image', ext: 'webp' })
    expect(cleanupBySourceTxMock).toHaveBeenCalledWith(TX, AVATAR_SLOT)
    expect(createTxMock).toHaveBeenCalledWith(TX, { fileEntryId: FILE_ID, ...AVATAR_SLOT, role: 'avatar' })
    expect(setTxMock).toHaveBeenCalledWith(TX, 'app.user.avatar', `file:${FILE_ID}`)
    expect(afterCommit).toHaveBeenCalledOnce()
    expect(permanentDeleteMock).not.toHaveBeenCalled()
  })

  it('compensates (permanentDelete) when the tx fails, and skips the post-commit callback', async () => {
    setTxMock.mockRejectedValueOnce(new Error('tx write failed'))

    await expect(
      profileHandlers['profile.set_avatar']({ kind: 'image', data: new Uint8Array([1]) }, ctx)
    ).rejects.toThrow('tx write failed')

    expect(permanentDeleteMock).toHaveBeenCalledWith(FILE_ID)
    expect(afterCommit).not.toHaveBeenCalled()
  })

  it('does NOT compensate when only the post-commit callback fails (the avatar is already committed)', async () => {
    afterCommit.mockRejectedValueOnce(new Error('broadcast failed'))

    await expect(
      profileHandlers['profile.set_avatar']({ kind: 'image', data: new Uint8Array([1]) }, ctx)
    ).rejects.toThrow('broadcast failed')

    expect(permanentDeleteMock).not.toHaveBeenCalled()
  })

  it('clears the slot and stores an emoji value (no file created)', async () => {
    await profileHandlers['profile.set_avatar']({ kind: 'emoji', emoji: '😀' }, ctx)

    expect(createInternalEntryMock).not.toHaveBeenCalled()
    expect(cleanupBySourceTxMock).toHaveBeenCalledWith(TX, AVATAR_SLOT)
    expect(createTxMock).not.toHaveBeenCalled()
    expect(setTxMock).toHaveBeenCalledWith(TX, 'app.user.avatar', '😀')
    expect(afterCommit).toHaveBeenCalledOnce()
  })

  it('clears the slot and resets to empty', async () => {
    await profileHandlers['profile.set_avatar']({ kind: 'clear' }, ctx)

    expect(createInternalEntryMock).not.toHaveBeenCalled()
    expect(cleanupBySourceTxMock).toHaveBeenCalledWith(TX, AVATAR_SLOT)
    expect(createTxMock).not.toHaveBeenCalled()
    expect(setTxMock).toHaveBeenCalledWith(TX, 'app.user.avatar', '')
    expect(afterCommit).toHaveBeenCalledOnce()
  })
})
