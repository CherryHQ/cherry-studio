import type { UIMessage } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { FileUIPart } from '@shared/data/types/message'

const { readMock, getByIdMock } = vi.hoisted(() => ({ readMock: vi.fn(), getByIdMock: vi.fn() }))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({ FileManager: { read: readMock, getById: getByIdMock } })
})

import { collectFileAttachments, prepareChatMessages } from '../attachmentRouting'

const part: FileUIPart = {
  type: 'file',
  filename: 'image.png',
  mediaType: 'image/png',
  url: 'file:///x/image.png',
  providerMetadata: { cherry: { fileEntryId: 'entry-1' } }
}
const messages: UIMessage[] = [{ id: 'm1', role: 'user', parts: [part] }]
const prepare = () =>
  prepareChatMessages(messages, {
    attachments: collectFileAttachments(messages),
    nativeSupport: { image: true, pdf: false, audio: false, video: false, imageFormatPolicy: 'reject-bmp' },
    isToolCapable: false
  })

describe('chat attachment format policy with the real fileProcessor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getByIdMock.mockResolvedValue({ ext: 'png' })
  })

  it('rejects BMP exposed only by the FileManager read MIME', async () => {
    readMock.mockResolvedValue({ content: Buffer.from('BM').toString('base64'), mime: 'image/bmp' })
    await expect(prepare()).rejects.toMatchObject({
      name: 'UnsupportedImageFormatError',
      i18nKey: 'unsupported_bmp_image'
    })
  })

  it('inlines PNG with its original bytes and MIME', async () => {
    const bytes = Buffer.from('89504e470d0a1a0a', 'hex')
    readMock.mockResolvedValue({ content: bytes.toString('base64'), mime: 'image/png' })
    const [out] = await prepare()
    expect(out.parts).toEqual([{ ...part, url: `data:image/png;base64,${bytes.toString('base64')}` }])
  })
})
