import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import type { UIMessage } from 'ai'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() }) }
}))

const { resolveFileUIPartMock } = vi.hoisted(() => ({
  resolveFileUIPartMock: vi.fn<(part: unknown) => Promise<unknown>>()
}))
vi.mock('../fileProcessor', () => ({ resolveFileUIPart: resolveFileUIPartMock }))

import { collectFileAttachments, prepareChatMessages } from '../attachmentManifest'

function userMessage(parts: CherryMessagePart[]): CherryUIMessage {
  return { id: 'm1', role: 'user', parts } as CherryUIMessage
}

const fileWithEntry = (id: string, filename: string, mediaType: string): CherryMessagePart =>
  ({
    type: 'file',
    url: `file:///x/${filename}`,
    mediaType,
    filename,
    providerMetadata: { cherry: { fileEntryId: id } }
  }) as CherryMessagePart

const legacyFile = (filename: string, mediaType: string): CherryMessagePart =>
  ({ type: 'file', url: `file:///x/${filename}`, mediaType }) as CherryMessagePart

const textParts = (parts: UIMessage['parts']) =>
  parts.filter((p): p is { type: 'text'; text: string } => p.type === 'text')

afterEach(() => vi.clearAllMocks())

describe('prepareChatMessages', () => {
  it('strips fileEntry attachments into a manifest (tool model) without inlining their bytes', async () => {
    const messages = [
      userMessage([
        { type: 'text', text: 'summarize these' } as CherryMessagePart,
        fileWithEntry('e1', 'report.pdf', 'application/pdf'),
        fileWithEntry('e2', 'photo.png', 'image/png')
      ])
    ] as UIMessage[]

    const [out] = await prepareChatMessages(messages, true)

    expect(out.parts.filter((p) => p.type === 'file')).toHaveLength(0)
    const texts = textParts(out.parts)
    expect(texts[0].text).toBe('summarize these')
    const manifest = texts[texts.length - 1].text
    expect(manifest).not.toContain('e1') // internal id never reaches the model
    expect(manifest).toContain('report.pdf (application/pdf)')
    expect(manifest).toContain('photo.png (image/png)')
    // fileEntry parts are read lazily via read_file — never eager-inlined.
    expect(resolveFileUIPartMock).not.toHaveBeenCalled()
  })

  it('inlines fileEntry attachments when the manifest is disabled (non-tool model)', async () => {
    resolveFileUIPartMock.mockResolvedValue({ type: 'file', url: 'data:inlined', mediaType: 'application/pdf' })
    const messages = [userMessage([fileWithEntry('e1', 'a.pdf', 'application/pdf')])] as UIMessage[]

    const [out] = await prepareChatMessages(messages, false)

    expect(resolveFileUIPartMock).toHaveBeenCalledTimes(1)
    expect(out.parts).toEqual([{ type: 'file', url: 'data:inlined', mediaType: 'application/pdf' }])
  })

  it('inlines legacy file parts (no fileEntryId) even when enabled', async () => {
    resolveFileUIPartMock.mockResolvedValue({ type: 'file', url: 'data:legacy', mediaType: 'application/pdf' })
    const messages = [userMessage([legacyFile('legacy.pdf', 'application/pdf')])] as UIMessage[]

    const [out] = await prepareChatMessages(messages, true)

    expect(resolveFileUIPartMock).toHaveBeenCalledTimes(1)
    expect(out.parts).toEqual([{ type: 'file', url: 'data:legacy', mediaType: 'application/pdf' }])
  })

  it('drops a file part that cannot be inlined', async () => {
    resolveFileUIPartMock.mockResolvedValue(null)
    const messages = [
      userMessage([{ type: 'text', text: 'keep me' } as CherryMessagePart, legacyFile('gone.pdf', 'application/pdf')])
    ] as UIMessage[]

    const [out] = await prepareChatMessages(messages, true)
    expect(out.parts).toEqual([{ type: 'text', text: 'keep me' }])
  })

  it('leaves messages without file parts untouched', async () => {
    const messages = [userMessage([{ type: 'text', text: 'hi' } as CherryMessagePart])] as UIMessage[]
    const [out] = await prepareChatMessages(messages, true)
    expect(out.parts).toEqual([{ type: 'text', text: 'hi' }])
    expect(resolveFileUIPartMock).not.toHaveBeenCalled()
  })
})

describe('collectFileAttachments', () => {
  it('flattens fileEntry-backed attachments across all messages into an allow-list', () => {
    const messages = [
      userMessage([fileWithEntry('e1', 'report.pdf', 'application/pdf')]),
      userMessage([{ type: 'text', text: 'more' } as CherryMessagePart, fileWithEntry('e2', 'photo.png', 'image/png')])
    ] as UIMessage[]
    expect(collectFileAttachments(messages)).toEqual([
      { fileEntryId: 'e1', filename: 'report.pdf', mediaType: 'application/pdf' },
      { fileEntryId: 'e2', filename: 'photo.png', mediaType: 'image/png' }
    ])
  })

  it('ignores file parts without a fileEntryId', () => {
    expect(collectFileAttachments([userMessage([legacyFile('legacy.pdf', 'application/pdf')])] as UIMessage[])).toEqual(
      []
    )
  })
})
