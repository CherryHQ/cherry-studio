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
vi.mock('@main/services/file/utils/entityImageWebp', () => ({ transcodeToEntityWebp: transcodeMock }))

import { LogoImageIntentSchema } from '@shared/ipc/schemas/entityImage'

import { entityImageHandlers } from '../entityImage'

const FILE_ID = '019606a0-0000-7000-8000-000000000003'
const WEBP = Buffer.from([7, 7])
const fileManager = { createInternalEntry: createInternalEntryMock, permanentDelete: permanentDeleteMock }
const ctx = { senderId: null }

beforeEach(() => {
  vi.clearAllMocks()
  appGetMock.mockImplementation((name: string) => {
    if (name === 'FileManager') return fileManager
    throw new Error(`Unexpected application.get(${name})`)
  })
  transcodeMock.mockResolvedValue(WEBP)
  createInternalEntryMock.mockResolvedValue({ id: FILE_ID })
  permanentDeleteMock.mockResolvedValue(undefined)
  providerUpdateMock.mockResolvedValue({})
  miniAppUpdateMock.mockResolvedValue({})
})

describe('provider.set_logo', () => {
  it('creates a file_entry from bytes and binds it via the service', async () => {
    const data = new Uint8Array([1, 2])
    await entityImageHandlers['provider.set_logo']({ providerId: 'p1', image: { kind: 'image', data } }, ctx)

    expect(transcodeMock).toHaveBeenCalledWith(data)
    expect(createInternalEntryMock).toHaveBeenCalledWith({ source: 'bytes', data: WEBP, name: 'image', ext: 'webp' })
    expect(providerUpdateMock).toHaveBeenCalledWith('p1', { logo: { kind: 'file', fileId: FILE_ID } })
    expect(permanentDeleteMock).not.toHaveBeenCalled()
  })

  it('binds a preset key without creating a file', async () => {
    await entityImageHandlers['provider.set_logo'](
      { providerId: 'p1', image: { kind: 'key', key: 'icon:openai' } },
      ctx
    )

    expect(createInternalEntryMock).not.toHaveBeenCalled()
    expect(providerUpdateMock).toHaveBeenCalledWith('p1', { logo: { kind: 'key', key: 'icon:openai' } })
  })

  it('binds a clear without creating a file', async () => {
    await entityImageHandlers['provider.set_logo']({ providerId: 'p1', image: { kind: 'clear' } }, ctx)

    expect(createInternalEntryMock).not.toHaveBeenCalled()
    expect(providerUpdateMock).toHaveBeenCalledWith('p1', { logo: { kind: 'clear' } })
  })

  it('compensates (permanentDelete) when the bind fails', async () => {
    providerUpdateMock.mockRejectedValueOnce(new Error('bind failed'))

    await expect(
      entityImageHandlers['provider.set_logo'](
        { providerId: 'p1', image: { kind: 'image', data: new Uint8Array([1]) } },
        ctx
      )
    ).rejects.toThrow('bind failed')

    expect(permanentDeleteMock).toHaveBeenCalledWith(FILE_ID)
  })
})

describe('LogoImageIntentSchema key variant', () => {
  it('accepts a preset key', () => {
    expect(LogoImageIntentSchema.safeParse({ kind: 'key', key: 'icon:openai' }).success).toBe(true)
  })

  it('rejects a data:/file: key — bytes / stored-file refs are not preset keys', () => {
    for (const key of ['data:image/png;base64,abc', `file:${FILE_ID}`, 'file:///tmp/x.png']) {
      expect(LogoImageIntentSchema.safeParse({ kind: 'key', key }).success).toBe(false)
    }
  })
})

describe('mini_app.set_logo', () => {
  it('creates a file_entry from bytes and binds it via the service', async () => {
    await entityImageHandlers['mini_app.set_logo'](
      { appId: 'a1', image: { kind: 'image', data: new Uint8Array([1]) } },
      ctx
    )

    expect(createInternalEntryMock).toHaveBeenCalled()
    expect(miniAppUpdateMock).toHaveBeenCalledWith('a1', { logo: { kind: 'file', fileId: FILE_ID } })
  })
})
