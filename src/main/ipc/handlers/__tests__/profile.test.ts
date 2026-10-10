import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'

const { files, fileManager, transcodeMock } = vi.hoisted(() => {
  const files = new Set<string>()
  return {
    files,
    fileManager: {
      createInternalEntry: vi.fn(),
      permanentDelete: vi.fn(async (id: string) => {
        files.delete(id)
      }),
      deleteUnreferencedInternalEntry: vi.fn(async (id: string) => files.delete(id))
    },
    transcodeMock: vi.fn()
  }
})

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({ FileManager: fileManager })
})
vi.mock('@main/utils/image', () => ({ transcodeToEntityWebp: transcodeMock }))

import { profileHandlers } from '../profile'

const OLD_ID = '019606a0-0000-7000-8000-000000000001'
const NEW_ID = '019606a0-0000-7000-8000-000000000002'
const LATER_ID = '019606a0-0000-7000-8000-000000000003'
const WEBP = Buffer.from([1, 2, 3])
const context = { senderId: null }
const image = { kind: 'image' as const, data: new Uint8Array([9, 9, 9]) }

beforeEach(() => {
  MockMainPreferenceServiceUtils.resetMocks()
  files.clear()
  fileManager.createInternalEntry.mockReset().mockImplementation(async () => {
    files.add(NEW_ID)
    return { id: NEW_ID }
  })
  fileManager.deleteUnreferencedInternalEntry.mockReset().mockImplementation(async (id) => files.delete(id))
  fileManager.permanentDelete.mockClear()
  transcodeMock.mockReset().mockResolvedValue(WEBP)
  mockMainLoggerService.error.mockClear()
})

function seedAvatar() {
  files.add(OLD_ID)
  MockMainPreferenceServiceUtils.setPreferenceValue('app.user.avatar', `file:${OLD_ID}`)
}

function avatar() {
  return MockMainPreferenceServiceUtils.getPreferenceValue('app.user.avatar')
}

describe('profile.set_avatar ownership', () => {
  it('keeps the uploaded image as the current avatar', async () => {
    await profileHandlers['profile.set_avatar'](image, context)

    expect(avatar()).toBe(`file:${NEW_ID}`)
    expect(files).toEqual(new Set([NEW_ID]))
  })

  it('retires the previous image only after its replacement is saved', async () => {
    seedAvatar()
    fileManager.deleteUnreferencedInternalEntry.mockImplementation(async (id) => {
      expect(avatar()).toBe(`file:${NEW_ID}`)
      return files.delete(id)
    })

    await profileHandlers['profile.set_avatar'](image, context)

    expect(files).toEqual(new Set([NEW_ID]))
  })

  it.each([{ kind: 'emoji', emoji: '😀' } as const, { kind: 'default' } as const])(
    'retires the previous image when changing to $kind',
    async (input) => {
      seedAvatar()

      await profileHandlers['profile.set_avatar'](input, context)

      expect(avatar()).toBe(input.kind === 'emoji' ? input.emoji : '')
      expect(files.size).toBe(0)
    }
  )

  it('keeps the old image and compensates the new one when saving fails', async () => {
    seedAvatar()
    vi.mocked(application.get('PreferenceService').set).mockRejectedValueOnce(new Error('save failed'))

    await expect(profileHandlers['profile.set_avatar'](image, context)).rejects.toThrow('save failed')

    expect(avatar()).toBe(`file:${OLD_ID}`)
    expect(files).toEqual(new Set([OLD_ID]))
  })

  it('keeps the old image when upload processing fails', async () => {
    seedAvatar()
    transcodeMock.mockRejectedValueOnce(new Error('invalid image'))

    await expect(profileHandlers['profile.set_avatar'](image, context)).rejects.toThrow('invalid image')

    expect(avatar()).toBe(`file:${OLD_ID}`)
    expect(files).toEqual(new Set([OLD_ID]))
  })

  it('retires intermediate images when updates overlap', async () => {
    seedAvatar()
    let finishProcessing!: (bytes: Buffer) => void
    transcodeMock.mockImplementationOnce(
      () =>
        new Promise<Buffer>((resolve) => {
          finishProcessing = resolve
        })
    )
    fileManager.createInternalEntry
      .mockImplementationOnce(async () => {
        files.add(NEW_ID)
        return { id: NEW_ID }
      })
      .mockImplementationOnce(async () => {
        files.add(LATER_ID)
        return { id: LATER_ID }
      })
    const first = profileHandlers['profile.set_avatar'](image, context)
    await vi.waitFor(() => expect(finishProcessing).toBeTypeOf('function'))
    const second = profileHandlers['profile.set_avatar'](image, context)
    finishProcessing(WEBP)

    await Promise.all([first, second])

    expect(files.size).toBe(1)
    expect(files.has(avatar().slice('file:'.length))).toBe(true)
  })

  it('keeps a shared image when FileManager declines its deletion', async () => {
    seedAvatar()
    fileManager.deleteUnreferencedInternalEntry.mockResolvedValueOnce(false)

    await profileHandlers['profile.set_avatar']({ kind: 'default' }, context)

    expect(avatar()).toBe('')
    expect(files).toEqual(new Set([OLD_ID]))
  })

  it('logs failed retirement and retries it on a later avatar update', async () => {
    seedAvatar()
    fileManager.deleteUnreferencedInternalEntry.mockRejectedValueOnce(new Error('database busy'))

    await profileHandlers['profile.set_avatar']({ kind: 'emoji', emoji: '😀' }, context)

    expect(avatar()).toBe('😀')
    expect(files).toEqual(new Set([OLD_ID]))
    expect(mockMainLoggerService.error).toHaveBeenCalled()

    await profileHandlers['profile.set_avatar']({ kind: 'default' }, context)

    expect(files.size).toBe(0)
  })
})
