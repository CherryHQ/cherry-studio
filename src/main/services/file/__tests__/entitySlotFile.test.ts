import { beforeEach, describe, expect, it, vi } from 'vitest'

const { appGetMock, fileRefServiceMock } = vi.hoisted(() => ({
  appGetMock: vi.fn(),
  fileRefServiceMock: { findBySource: vi.fn(), create: vi.fn() }
}))
vi.mock('@application', () => ({ application: { get: appGetMock } }))
vi.mock('@data/services/FileRefService', () => ({ fileRefService: fileRefServiceMock }))

import { clearEntitySlot, putEntitySlotFile } from '../entitySlotFile'

const ids = ['019606a0-0000-7000-8000-000000000001', '019606a0-0000-7000-8000-000000000002']

const fileManager = {
  createInternalEntry: vi.fn(),
  permanentDelete: vi.fn()
}

beforeEach(() => {
  vi.clearAllMocks()
  appGetMock.mockImplementation((name: string) => {
    if (name === 'FileManager') return fileManager
    throw new Error(`Unexpected application.get(${name})`)
  })
})

describe('putEntitySlotFile', () => {
  it('stores the given bytes as an internal entry and replaces the prior slot entry', async () => {
    const slot = { sourceType: 'user_avatar' as const, sourceId: 'default', role: 'avatar' }
    const data = new Uint8Array([9, 9])
    fileManager.createInternalEntry.mockResolvedValue({ id: ids[0] })
    // findBySource runs after the new ref is inserted, so it sees the new ref,
    // the prior same-role entry, and an unrelated role.
    fileRefServiceMock.findBySource.mockResolvedValue([
      { fileEntryId: ids[0], role: 'avatar' },
      { fileEntryId: ids[1], role: 'avatar' },
      { fileEntryId: 'other-entry', role: 'logo' }
    ])
    fileManager.permanentDelete.mockResolvedValue(undefined)

    await expect(putEntitySlotFile({ ...slot, data, ext: 'webp' })).resolves.toEqual({ fileId: ids[0] })

    // The caller's bytes/ext are stored as-is — no normalization in this layer.
    expect(fileManager.createInternalEntry).toHaveBeenCalledWith({
      source: 'bytes',
      data,
      name: 'user_avatar',
      ext: 'webp'
    })
    expect(fileRefServiceMock.create).toHaveBeenCalledWith({ fileEntryId: ids[0], ...slot })
    // Only the superseded same-role entry is pruned — never the new one or other roles.
    expect(fileManager.permanentDelete).toHaveBeenCalledTimes(1)
    expect(fileManager.permanentDelete).toHaveBeenCalledWith(ids[1])
  })

  it('prunes nothing when the slot had no prior entry', async () => {
    fileManager.createInternalEntry.mockResolvedValue({ id: ids[0] })
    fileRefServiceMock.findBySource.mockResolvedValue([{ fileEntryId: ids[0], role: 'avatar' }])

    await putEntitySlotFile({
      sourceType: 'user_avatar',
      sourceId: 'default',
      role: 'avatar',
      data: new Uint8Array([1]),
      ext: 'webp'
    })

    expect(fileManager.permanentDelete).not.toHaveBeenCalled()
  })
})

describe('clearEntitySlot', () => {
  it('permanent-deletes every entry for the slot+role', async () => {
    fileRefServiceMock.findBySource.mockResolvedValue([
      { fileEntryId: ids[0], role: 'avatar' },
      { fileEntryId: ids[1], role: 'avatar' },
      { fileEntryId: 'other-entry', role: 'logo' }
    ])
    fileManager.permanentDelete.mockResolvedValue(undefined)

    await clearEntitySlot({ sourceType: 'user_avatar', sourceId: 'default', role: 'avatar' })

    expect(fileRefServiceMock.findBySource).toHaveBeenCalledWith({ sourceType: 'user_avatar', sourceId: 'default' })
    expect(fileManager.permanentDelete).toHaveBeenCalledTimes(2)
    expect(fileManager.permanentDelete).toHaveBeenCalledWith(ids[0])
    expect(fileManager.permanentDelete).toHaveBeenCalledWith(ids[1])
  })
})
