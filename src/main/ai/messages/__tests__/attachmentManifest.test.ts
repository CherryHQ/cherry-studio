import type { NativeFileSupport } from '@main/ai/runtime/aiSdk/params/fileToolCapabilities'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import type { UIMessage } from 'ai'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() }) }
}))

const { getByIdMock } = vi.hoisted(() => ({ getByIdMock: vi.fn<(id: string) => Promise<{ ext: string | null }>>() }))
vi.mock('@main/core/application', () => ({ application: { get: () => ({ getById: getByIdMock }) } }))

const { resolveMock } = vi.hoisted(() => ({ resolveMock: vi.fn() }))
vi.mock('../fileProcessor', () => ({ resolveFileUIPart: resolveMock }))

const { extractMock } = vi.hoisted(() => ({ extractMock: vi.fn<() => Promise<string>>() }))
vi.mock('@main/utils/file/documentExtraction', () => ({
  extractDocumentText: extractMock,
  noExtractableTextNote: (filename: string) => `No text in ${filename}`
}))

const { ocrMock } = vi.hoisted(() => ({ ocrMock: vi.fn<() => Promise<string>>() }))
vi.mock('@main/features/fileProcessing', () => ({ ocrImageToText: ocrMock }))

import { collectFileAttachments, prepareChatMessages } from '../attachmentManifest'

const NONE: NativeFileSupport = { image: false, pdf: false, audio: false, video: false }
const ALL: NativeFileSupport = { image: true, pdf: true, audio: true, video: true }

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

const run = (
  parts: CherryMessagePart[],
  ns: NativeFileSupport,
  opts: { isToolCapable?: boolean; cap?: number } = {}
) => {
  const messages = [userMessage(parts)] as UIMessage[]
  return prepareChatMessages(messages, {
    attachments: collectFileAttachments(messages),
    nativeSupport: ns,
    isToolCapable: opts.isToolCapable ?? true,
    cap: opts.cap
  })
}

const textOf = (parts: UIMessage['parts']) =>
  parts.filter((p): p is { type: 'text'; text: string } => p.type === 'text').map((p) => p.text)

afterEach(() => vi.clearAllMocks())

describe('prepareChatMessages — routing', () => {
  it('keeps a native image inline (no extraction)', async () => {
    getByIdMock.mockResolvedValueOnce({ ext: 'png' })
    resolveMock.mockImplementation(async (p) => p)
    const [out] = await run([fileWithEntry('e1', 'a.png', 'image/png')], ALL)
    expect(out.parts.filter((p) => p.type === 'file')).toHaveLength(1)
    expect(resolveMock).toHaveBeenCalled()
    expect(ocrMock).not.toHaveBeenCalled()
    expect(extractMock).not.toHaveBeenCalled()
  })

  it('OCRs a non-vision image into inline text', async () => {
    getByIdMock.mockResolvedValueOnce({ ext: 'png' })
    ocrMock.mockResolvedValueOnce('ocr body')
    const [out] = await run([fileWithEntry('e1', 'a.png', 'image/png')], NONE)
    expect(out.parts.filter((p) => p.type === 'file')).toHaveLength(0)
    expect(textOf(out.parts)[0]).toBe('Attached file "a.png":\nocr body')
  })

  it('inlines extracted text for office docs', async () => {
    getByIdMock.mockResolvedValueOnce({ ext: 'docx' })
    extractMock.mockResolvedValueOnce('word body')
    const [out] = await run([fileWithEntry('e1', 'a.docx', 'application/octet-stream')], ALL)
    expect(textOf(out.parts)[0]).toBe('Attached file "a.docx":\nword body')
  })

  it('keeps a native PDF inline, extracts text for a non-native one', async () => {
    getByIdMock.mockResolvedValueOnce({ ext: 'pdf' })
    resolveMock.mockImplementation(async (p) => p)
    const [nativeOut] = await run([fileWithEntry('e1', 'a.pdf', 'application/pdf')], ALL)
    expect(nativeOut.parts.filter((p) => p.type === 'file')).toHaveLength(1)

    getByIdMock.mockResolvedValueOnce({ ext: 'pdf' })
    extractMock.mockResolvedValueOnce('pdf body')
    const [textOut] = await run([fileWithEntry('e1', 'a.pdf', 'application/pdf')], NONE)
    expect(textOf(textOut.parts)[0]).toBe('Attached file "a.pdf":\npdf body')
  })

  it('notes audio it cannot read', async () => {
    getByIdMock.mockResolvedValueOnce({ ext: 'mp3' })
    const [out] = await run([fileWithEntry('e1', 'a.mp3', 'audio/mpeg')], NONE)
    expect(textOf(out.parts)[0]).toContain("can't process the attached audio file")
  })

  it('uses the empty-extraction note', async () => {
    getByIdMock.mockResolvedValueOnce({ ext: 'pdf' })
    extractMock.mockResolvedValueOnce('   ')
    const [out] = await run([fileWithEntry('e1', 'a.pdf', 'application/pdf')], NONE)
    expect(textOf(out.parts)[0]).toBe('Attached file "a.pdf":\nNo text in a.pdf')
  })

  it('caps long text with a read_file pointer for tool models', async () => {
    getByIdMock.mockResolvedValueOnce({ ext: 'txt' })
    extractMock.mockResolvedValueOnce('0123456789')
    const [out] = await run([fileWithEntry('e1', 'a.txt', 'text/plain')], NONE, { isToolCapable: true, cap: 5 })
    const text = textOf(out.parts)[0]
    expect(text).toContain('01234')
    expect(text).toContain('read_file("a.txt", offset=5)')
  })

  it('caps long text without a read_file pointer for non-tool models', async () => {
    getByIdMock.mockResolvedValueOnce({ ext: 'txt' })
    extractMock.mockResolvedValueOnce('0123456789')
    const [out] = await run([fileWithEntry('e1', 'a.txt', 'text/plain')], NONE, { isToolCapable: false, cap: 5 })
    const text = textOf(out.parts)[0]
    expect(text).toContain('[Truncated 5/10 chars.]')
    expect(text).not.toContain('read_file')
  })

  it('eager-inlines legacy parts without a fileEntryId (no getById)', async () => {
    resolveMock.mockResolvedValueOnce({ type: 'file', url: 'data:inlined', mediaType: 'application/pdf' })
    const legacy = { type: 'file', url: 'file:///x/legacy.pdf', mediaType: 'application/pdf' } as CherryMessagePart
    const [out] = await prepareChatMessages([userMessage([legacy])] as UIMessage[], {
      attachments: [],
      nativeSupport: NONE,
      isToolCapable: true
    })
    expect(getByIdMock).not.toHaveBeenCalled()
    expect(out.parts).toEqual([{ type: 'file', url: 'data:inlined', mediaType: 'application/pdf' }])
  })
})

describe('collectFileAttachments', () => {
  it('flattens fileEntry attachments with unique filenames', () => {
    const messages = [
      userMessage([fileWithEntry('e1', 'report.pdf', 'application/pdf')]),
      userMessage([fileWithEntry('e2', 'report.pdf', 'application/pdf')])
    ] as UIMessage[]
    expect(collectFileAttachments(messages)).toEqual([
      { fileEntryId: 'e1', filename: 'report.pdf', mediaType: 'application/pdf' },
      { fileEntryId: 'e2', filename: 'report.pdf (2)', mediaType: 'application/pdf' }
    ])
  })

  it('ignores file parts without a fileEntryId', () => {
    const legacy = { type: 'file', url: 'file:///x/legacy.pdf', mediaType: 'application/pdf' } as CherryMessagePart
    expect(collectFileAttachments([userMessage([legacy])] as UIMessage[])).toEqual([])
  })
})
