import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  appGetMock,
  providerUpdateMock,
  miniAppUpdateMock,
  createInternalEntryMock,
  permanentDeleteMock,
  transcodeMock
} = vi.hoisted(() => ({
  appGetMock: vi.fn(),
  providerUpdateMock: vi.fn(),
  miniAppUpdateMock: vi.fn(),
  createInternalEntryMock: vi.fn(),
  permanentDeleteMock: vi.fn(),
  transcodeMock: vi.fn()
}))
vi.mock('@application', () => ({ application: { get: appGetMock } }))
vi.mock('@data/services/ProviderService', () => ({ providerService: { update: providerUpdateMock } }))
vi.mock('@data/services/MiniAppService', () => ({ miniAppService: { update: miniAppUpdateMock } }))
vi.mock('@main/utils/image', () => ({ transcodeToEntityWebp: transcodeMock }))

import { setMiniAppLogo, setProviderLogo } from '../entityLogo'

const FILE_ID = '019606a0-0000-7000-8000-000000000003'
const WEBP = Buffer.from([7, 7])
const fileManager = { createInternalEntry: createInternalEntryMock, permanentDelete: permanentDeleteMock }

beforeEach(() => {
  vi.clearAllMocks()
  appGetMock.mockImplementation((name: string) => {
    if (name === 'FileManager') return fileManager
    throw new Error(`Unexpected application.get(${name})`)
  })
  transcodeMock.mockResolvedValue(WEBP)
  createInternalEntryMock.mockResolvedValue({ id: FILE_ID })
  permanentDeleteMock.mockResolvedValue(undefined)
  providerUpdateMock.mockReturnValue({})
  miniAppUpdateMock.mockReturnValue({})
})

describe('setProviderLogo', () => {
  it('creates a file_entry from bytes and binds it via the service', async () => {
    const data = new Uint8Array([1, 2])
    await setProviderLogo('p1', { kind: 'image', data })

    expect(transcodeMock).toHaveBeenCalledWith(data)
    expect(createInternalEntryMock).toHaveBeenCalledWith({
      source: 'bytes',
      data: WEBP,
      name: 'image',
      ext: 'webp',
      cleanupPolicy: 'delete_when_unreferenced'
    })
    expect(providerUpdateMock).toHaveBeenCalledWith('p1', { logo: { kind: 'file', fileId: FILE_ID } })
    expect(permanentDeleteMock).not.toHaveBeenCalled()
  })

  it('binds a preset key without creating a file', async () => {
    await setProviderLogo('p1', { kind: 'key', key: 'icon:openai' })

    expect(createInternalEntryMock).not.toHaveBeenCalled()
    expect(providerUpdateMock).toHaveBeenCalledWith('p1', { logo: { kind: 'key', key: 'icon:openai' } })
  })

  it('binds a default without creating a file', async () => {
    await setProviderLogo('p1', { kind: 'default' })

    expect(createInternalEntryMock).not.toHaveBeenCalled()
    expect(providerUpdateMock).toHaveBeenCalledWith('p1', { logo: { kind: 'default' } })
  })

  it('compensates (permanentDelete) when the bind fails', async () => {
    providerUpdateMock.mockImplementationOnce(() => {
      throw new Error('bind failed')
    })

    await expect(setProviderLogo('p1', { kind: 'image', data: new Uint8Array([1]) })).rejects.toThrow('bind failed')

    expect(permanentDeleteMock).toHaveBeenCalledWith(FILE_ID)
  })

  it('rethrows the original bind error even when the compensating delete also fails', async () => {
    providerUpdateMock.mockImplementationOnce(() => {
      throw new Error('bind failed')
    })
    permanentDeleteMock.mockRejectedValueOnce(new Error('cleanup failed'))

    // The compensating-delete failure is swallowed (logged) — the original bind
    // error must still surface, not be masked by the cleanup error.
    await expect(setProviderLogo('p1', { kind: 'image', data: new Uint8Array([1]) })).rejects.toThrow('bind failed')

    expect(permanentDeleteMock).toHaveBeenCalledWith(FILE_ID)
  })
})

describe('setMiniAppLogo', () => {
  it('creates a file_entry from bytes and binds it via the service', async () => {
    await setMiniAppLogo('a1', { kind: 'image', data: new Uint8Array([1]) })

    expect(createInternalEntryMock).toHaveBeenCalled()
    expect(miniAppUpdateMock).toHaveBeenCalledWith('a1', { logo: { kind: 'file', fileId: FILE_ID } })
  })

  it('compensates (permanentDelete) when the bind fails', async () => {
    miniAppUpdateMock.mockImplementationOnce(() => {
      throw new Error('bind failed')
    })

    await expect(setMiniAppLogo('a1', { kind: 'image', data: new Uint8Array([1]) })).rejects.toThrow('bind failed')

    expect(permanentDeleteMock).toHaveBeenCalledWith(FILE_ID)
  })
})
