import type { UIMessage } from 'ai'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { NativeFileSupport } from '@main/ai/runtime/aiSdk/params/nativeFileSupport'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'

import type * as FileProcessorModule from '../fileProcessor'

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() }) }
}))

const { getByIdMock, mediaAnalysisMock, probeMock, ocrMock } = vi.hoisted(() => ({
  getByIdMock: vi.fn<(id: string) => Promise<{ ext: string | null }>>(),
  mediaAnalysisMock: vi.fn<(file: { kind: 'entry'; entryId: string }, signal?: AbortSignal) => Promise<string>>(),
  probeMock: vi.fn<
    (
      file: { kind: 'entry'; entryId: string },
      signal?: AbortSignal
    ) => Promise<{
      durationMs: number
      hasAudio: boolean
      hasVideo: boolean
      mime: string
      kind: 'audio' | 'video' | 'unknown'
    }>
  >(),
  ocrMock: vi.fn<() => Promise<string>>()
}))
vi.mock('@application', () => ({
  application: {
    get: (name: string) => {
      if (name === 'FileProcessingService') return { ocrImage: ocrMock }
      if (name === 'MediaAnalysisService') return { analyzeToCompactText: mediaAnalysisMock, probe: probeMock }
      return { getById: getByIdMock, read: readMock }
    }
  }
}))

const { readMock, resolveMock, materializerMode } = vi.hoisted(() => ({
  readMock: vi.fn<(id: string, options: { encoding: 'base64' }) => Promise<{ content: string; mime: string }>>(),
  resolveMock: vi.fn(),
  materializerMode: { real: false }
}))
vi.mock('../fileProcessor', async () => {
  const actual = await vi.importActual<typeof FileProcessorModule>('../fileProcessor')
  return {
    materializeNativeFilePart: (
      part: Parameters<typeof actual.materializeNativeFilePart>[0],
      options?: Parameters<typeof actual.materializeNativeFilePart>[1]
    ) => (materializerMode.real ? actual.materializeNativeFilePart(part, options) : resolveMock(part, options))
  }
})

const { extractMock } = vi.hoisted(() => ({ extractMock: vi.fn<() => Promise<string | null>>() }))
vi.mock('../attachmentTextExtraction', () => ({
  extractDocumentText: extractMock,
  noExtractableTextNote: (name: string) => `No text in ${name}`
}))

import { collectFileAttachments, prepareChatMessages } from '../attachmentRouting'

const NONE: NativeFileSupport = { image: false, pdf: false, audio: false, video: false }
const ALL: NativeFileSupport = { image: true, pdf: true, audio: true, video: true }

function userMessage(parts: CherryMessagePart[]): CherryUIMessage {
  return { id: 'm1', role: 'user', parts }
}
const fileWithEntry = (
  id: string,
  filename: string,
  mediaType: string,
  fileTokenSourceId?: string
): CherryMessagePart => ({
  type: 'file',
  url: `file:///x/${filename}`,
  mediaType,
  filename,
  providerMetadata: { cherry: { fileEntryId: id, ...(fileTokenSourceId ? { fileTokenSourceId } : {}) } }
})

const composerText = (text: string, ...fileTokenSourceIds: string[]): CherryMessagePart => ({
  type: 'text',
  text,
  providerMetadata: {
    cherry: {
      composer: {
        version: 1,
        tokens: fileTokenSourceIds.map((sourceId, index) => ({
          id: `file:${sourceId}`,
          kind: 'file',
          label: `${sourceId}.png`,
          index,
          textOffset: 0
        }))
      }
    }
  }
})

/** One token per character, so a test's `cap` reads directly as a character cap. */
const charTokenizer = { id: 'chars', count: (text: string) => text.length }

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
    budget: opts.cap === undefined ? undefined : { tokens: opts.cap, tokenizer: charTokenizer }
  })
}

const textOf = (parts: UIMessage['parts']) =>
  parts.filter((p): p is { type: 'text'; text: string } => p.type === 'text').map((p) => p.text)

afterEach(() => {
  materializerMode.real = false
  vi.clearAllMocks()
})

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

  it.each([
    ['audio', 'mp3', 'audio/mpeg'],
    ['video', 'mp4', 'video/mp4']
  ] as const)('keeps a supported managed %s part inline', async (_kind, ext, mediaType) => {
    getByIdMock.mockResolvedValueOnce({ ext })
    resolveMock.mockImplementation(async (part) => part)

    const [out] = await run([fileWithEntry('e1', `media.${ext}`, mediaType)], ALL)

    expect(out.parts).toEqual([expect.objectContaining({ type: 'file', filename: `media.${ext}`, mediaType })])
    expect(resolveMock).toHaveBeenCalledOnce()
    expect(mediaAnalysisMock).not.toHaveBeenCalled()
    expect(probeMock).not.toHaveBeenCalled()
    expect(extractMock).not.toHaveBeenCalled()
  })

  it('keeps an ordinary audio file on the stored MIME instead of the UI hint', async () => {
    materializerMode.real = true
    getByIdMock.mockResolvedValueOnce({ ext: 'mp3' })
    readMock.mockResolvedValueOnce({ content: 'QVVESU8=', mime: 'audio/mpeg' })

    const [out] = await run([fileWithEntry('e1', 'clip.mp3', 'video/webm')], ALL)

    expect(out.parts).toEqual([
      expect.objectContaining({
        type: 'file',
        filename: 'clip.mp3',
        mediaType: 'audio/mpeg',
        url: 'data:audio/mpeg;base64,QVVESU8='
      })
    ])
    expect(probeMock).not.toHaveBeenCalled()
  })

  it('OCRs a legacy non-vision image without composer source metadata', async () => {
    getByIdMock.mockResolvedValueOnce({ ext: 'png' })
    ocrMock.mockResolvedValueOnce('ocr body')
    const [out] = await run([fileWithEntry('e1', 'a.png', 'image/png')], NONE)
    expect(out.parts.filter((p) => p.type === 'file')).toHaveLength(0)
    expect(textOf(out.parts)[0]).toBe('Attached file "a.png":\nocr body')
  })

  it('OCRs a modern non-vision image whose composer token matches its source id', async () => {
    getByIdMock.mockResolvedValueOnce({ ext: 'png' })
    ocrMock.mockResolvedValueOnce('ocr body')

    const [out] = await run(
      [composerText('attached', 'source-1'), fileWithEntry('e1', 'a.png', 'image/png', 'source-1')],
      NONE
    )

    expect(textOf(out.parts)).toEqual(['attached', 'Attached file "a.png":\nocr body'])
    expect(ocrMock).toHaveBeenCalledOnce()
  })

  it('ignores a modern managed image whose composer token no longer references its source id', async () => {
    const [out] = await run(
      [composerText('text only', 'different-source'), fileWithEntry('e1', 'stale.png', 'image/png', 'stale-source')],
      NONE
    )

    expect(out.parts).toEqual([composerText('text only', 'different-source')])
    expect(getByIdMock).not.toHaveBeenCalled()
    expect(ocrMock).not.toHaveBeenCalled()
  })

  it('does not OCR a stale retained attachment when the effective messages are text-only', async () => {
    const message = userMessage([{ type: 'text', text: 'text only' }])

    const out = await prepareChatMessages([message] as UIMessage[], {
      attachments: [{ fileEntryId: 'stale-entry', handle: 'stale.png', displayName: 'stale.png' }],
      nativeSupport: NONE,
      isToolCapable: true
    })

    expect(out).toEqual([message])
    expect(getByIdMock).not.toHaveBeenCalled()
    expect(ocrMock).not.toHaveBeenCalled()
  })

  it('rejects before native materialization when OCR finds no text', async () => {
    getByIdMock.mockResolvedValueOnce({ ext: 'png' })
    ocrMock.mockResolvedValueOnce('   ')

    // The detail key tells an empty OCR result apart from a failing OCR path (#20343).
    // The reason rides the i18n fields, never `message`: provider-flavored wording in
    // the message would hand the error to the chat provider's auth classifier.
    await expect(run([fileWithEntry('e1', 'a.png', 'image/png')], NONE)).rejects.toMatchObject({
      name: 'NonVisionImageOcrError',
      i18nKey: 'image_unreadable_for_non_vision_model',
      detailI18nKey: 'ocr_detail_empty',
      message: expect.not.stringContaining('OCR')
    })

    expect(resolveMock).not.toHaveBeenCalled()
  })

  it('rejects before native materialization when OCR is unconfigured or fails', async () => {
    getByIdMock.mockResolvedValueOnce({ ext: 'png' })
    ocrMock.mockRejectedValueOnce(new Error('Default file processor for image_to_text is not configured'))

    await expect(run([fileWithEntry('e1', 'a.png', 'image/png')], NONE)).rejects.toMatchObject({
      name: 'NonVisionImageOcrError',
      i18nKey: 'image_unreadable_for_non_vision_model',
      detailI18nKey: 'ocr_detail_failed',
      detailI18nValues: { reason: 'Default file processor for image_to_text is not configured' }
    })

    expect(resolveMock).not.toHaveBeenCalled()
  })

  it('inlines extracted text for office docs', async () => {
    getByIdMock.mockResolvedValueOnce({ ext: 'docx' })
    extractMock.mockResolvedValueOnce('word body')
    const [out] = await run([fileWithEntry('e1', 'a.docx', 'application/octet-stream')], ALL)
    expect(textOf(out.parts)[0]).toBe('Attached file "a.docx":\nword body')
  })

  it('inlines XML text with an unrecognized extension', async () => {
    getByIdMock.mockResolvedValueOnce({ ext: 'lrmx' })
    const text = '<XingMing>张三</XingMing>'
    extractMock.mockResolvedValueOnce(text)
    const [out] = await run([fileWithEntry('e1', 'a.lrmx', 'application/octet-stream')], NONE)
    expect(textOf(out.parts)).toEqual([`Attached file "a.lrmx":\n${text}`])
  })

  it('inlines extracted text for an extensionless text file', async () => {
    getByIdMock.mockResolvedValueOnce({ ext: null })
    extractMock.mockResolvedValueOnce('license body')
    const [out] = await run([fileWithEntry('e1', 'LICENSE', 'application/octet-stream')], NONE)
    expect(textOf(out.parts)[0]).toBe('Attached file "LICENSE":\nlicense body')
  })

  it('keeps an extensionless binary file unsupported', async () => {
    getByIdMock.mockResolvedValueOnce({ ext: null })
    extractMock.mockResolvedValueOnce(null)
    const [out] = await run([fileWithEntry('e1', 'payload', 'application/octet-stream')], NONE)
    expect(textOf(out.parts)[0]).toBe(
      'Attached file "payload":\nCannot read the attached file "payload" as text (unsupported file type).'
    )
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

  it.each([
    ['audio', 'mp3', 'audio/mpeg'],
    ['video', 'mp4', 'video/mp4']
  ] as const)('analyzes a managed %s part the endpoint cannot process', async (_kind, ext, mediaType) => {
    getByIdMock.mockResolvedValueOnce({ ext })
    mediaAnalysisMock.mockResolvedValueOnce('# Media analysis\n[0:00] compact result')

    const [out] = await run([fileWithEntry('e1', `media.${ext}`, mediaType)], NONE)

    expect(textOf(out.parts)[0]).toBe(`Attached file "media.${ext}":\n# Media analysis\n[0:00] compact result`)
    expect(mediaAnalysisMock).toHaveBeenCalledWith({ kind: 'entry', entryId: 'e1' }, undefined)
    expect(probeMock).not.toHaveBeenCalled()
    expect(resolveMock).not.toHaveBeenCalled()
  })

  it.each(['probe failed', 'unusable_media_analysis'])(
    'degrades a non-native video to a clear note when media analysis fails: %s',
    async (message) => {
      getByIdMock.mockResolvedValueOnce({ ext: 'mp4' })
      mediaAnalysisMock.mockRejectedValueOnce(new Error(message))

      const [out] = await run([fileWithEntry('e1', 'media.mp4', 'video/mp4')], NONE)

      expect(textOf(out.parts)[0]).toBe(
        'Attached file "media.mp4":\nCould not analyze the attached video file "media.mp4".'
      )
      expect(resolveMock).not.toHaveBeenCalled()
    }
  )

  it('rethrows cancellation from media analysis', async () => {
    const controller = new AbortController()
    getByIdMock.mockResolvedValueOnce({ ext: 'mp4' })
    mediaAnalysisMock.mockImplementationOnce(async () => {
      controller.abort()
      throw new DOMException('Aborted', 'AbortError')
    })

    const messages = [userMessage([fileWithEntry('e1', 'media.mp4', 'video/mp4')])] as UIMessage[]
    await expect(
      prepareChatMessages(messages, {
        attachments: collectFileAttachments(messages),
        nativeSupport: NONE,
        isToolCapable: true,
        signal: controller.signal
      })
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  describe('ambiguous WebM', () => {
    const audioOnly = {
      durationMs: 1000,
      hasAudio: true,
      hasVideo: false,
      mime: 'audio/webm',
      kind: 'audio' as const
    }
    const withVideo = {
      durationMs: 1000,
      hasAudio: true,
      hasVideo: true,
      mime: 'video/webm',
      kind: 'video' as const
    }
    const audioNative: NativeFileSupport = { image: false, pdf: false, audio: true, video: false }
    const videoNative: NativeFileSupport = { image: false, pdf: false, audio: false, video: true }

    it('keeps audio-only WebM native when the model accepts audio but not video', async () => {
      materializerMode.real = true
      getByIdMock.mockResolvedValueOnce({ ext: 'webm' })
      probeMock.mockResolvedValueOnce(audioOnly)
      readMock.mockResolvedValueOnce({ content: 'QVVESU8=', mime: 'video/webm' })

      const [out] = await run([fileWithEntry('e1', 'clip.webm', 'video/webm')], audioNative)

      expect(probeMock).toHaveBeenCalledWith({ kind: 'entry', entryId: 'e1' }, undefined)
      expect(out.parts).toEqual([
        expect.objectContaining({
          type: 'file',
          filename: 'clip.webm',
          mediaType: 'audio/webm',
          url: 'data:audio/webm;base64,QVVESU8='
        })
      ])
      expect(mediaAnalysisMock).not.toHaveBeenCalled()
    })

    it('dispatches a renamed Matroska container as the probed MIME', async () => {
      materializerMode.real = true
      getByIdMock.mockResolvedValueOnce({ ext: 'webm' })
      probeMock.mockResolvedValueOnce({
        durationMs: 1000,
        hasAudio: true,
        hasVideo: false,
        mime: 'audio/x-matroska',
        kind: 'audio'
      })
      readMock.mockResolvedValueOnce({ content: 'TUFUUk9TS0E=', mime: 'video/webm' })

      const [out] = await run([fileWithEntry('e1', 'clip.webm', 'video/webm')], audioNative)

      expect(out.parts).toEqual([
        expect.objectContaining({
          type: 'file',
          filename: 'clip.webm',
          mediaType: 'audio/x-matroska',
          url: 'data:audio/x-matroska;base64,TUFUUk9TS0E='
        })
      ])
      expect(mediaAnalysisMock).not.toHaveBeenCalled()
    })

    it('does not deliver audio-only WebM as native video', async () => {
      getByIdMock.mockResolvedValueOnce({ ext: '.webm' })
      probeMock.mockResolvedValueOnce(audioOnly)
      mediaAnalysisMock.mockResolvedValueOnce('transcript')

      const [out] = await run([fileWithEntry('e1', 'clip.webm', 'video/webm')], videoNative)

      expect(probeMock).toHaveBeenCalledWith({ kind: 'entry', entryId: 'e1' }, undefined)
      expect(resolveMock).not.toHaveBeenCalled()
      expect(readMock).not.toHaveBeenCalled()
      expect(mediaAnalysisMock).toHaveBeenCalledWith({ kind: 'entry', entryId: 'e1' }, undefined)
      expect(textOf(out.parts)[0]).toBe('Attached file "clip.webm":\ntranscript')
    })

    it('keeps video WebM native only when the model accepts video', async () => {
      materializerMode.real = true
      getByIdMock.mockResolvedValueOnce({ ext: 'webm' })
      probeMock.mockResolvedValueOnce(withVideo)
      readMock.mockResolvedValueOnce({ content: 'VklERU8=', mime: 'audio/webm' })

      const [out] = await run([fileWithEntry('e1', 'clip.webm', 'video/webm')], videoNative)

      expect(out.parts).toEqual([
        expect.objectContaining({
          type: 'file',
          filename: 'clip.webm',
          mediaType: 'video/webm',
          url: 'data:video/webm;base64,VklERU8='
        })
      ])
      expect(mediaAnalysisMock).not.toHaveBeenCalled()
    })

    it('analyzes video WebM when the model accepts audio but not video', async () => {
      getByIdMock.mockResolvedValueOnce({ ext: 'webm' })
      probeMock.mockResolvedValueOnce(withVideo)
      mediaAnalysisMock.mockResolvedValueOnce('frames')

      const [out] = await run([fileWithEntry('e1', 'clip.webm', 'video/webm')], audioNative)

      expect(resolveMock).not.toHaveBeenCalled()
      expect(mediaAnalysisMock).toHaveBeenCalledWith({ kind: 'entry', entryId: 'e1' }, undefined)
      expect(textOf(out.parts)[0]).toBe('Attached file "clip.webm":\nframes')
    })

    it('analyzes WebM for a model with no native audio or video support', async () => {
      getByIdMock.mockResolvedValueOnce({ ext: 'webm' })
      probeMock.mockResolvedValueOnce(audioOnly)
      mediaAnalysisMock.mockResolvedValueOnce('transcript')

      const [out] = await run([fileWithEntry('e1', 'clip.webm', 'audio/webm')], NONE)

      expect(resolveMock).not.toHaveBeenCalled()
      expect(textOf(out.parts)[0]).toBe('Attached file "clip.webm":\ntranscript')
    })

    it('does not analyze a WebM probe that finds neither audio nor video', async () => {
      getByIdMock.mockResolvedValueOnce({ ext: 'webm' })
      probeMock.mockResolvedValueOnce({
        durationMs: 0,
        hasAudio: false,
        hasVideo: false,
        mime: 'application/octet-stream',
        kind: 'unknown'
      })

      const [out] = await run([fileWithEntry('e1', 'clip.webm', 'video/webm')], ALL)

      expect(probeMock).toHaveBeenCalledOnce()
      expect(resolveMock).not.toHaveBeenCalled()
      expect(mediaAnalysisMock).not.toHaveBeenCalled()
      expect(textOf(out.parts)[0]).toBe(
        'Attached file "clip.webm":\nCannot read the attached file "clip.webm" as text (unsupported file type).'
      )
    })

    it('rethrows cancellation from the WebM probe', async () => {
      materializerMode.real = true
      const controller = new AbortController()
      getByIdMock.mockResolvedValueOnce({ ext: 'webm' })
      probeMock.mockImplementationOnce(async (_file, signal) => {
        expect(signal).toBe(controller.signal)
        controller.abort()
        throw new DOMException('Aborted', 'AbortError')
      })

      const messages = [userMessage([fileWithEntry('e1', 'clip.webm', 'video/webm')])] as UIMessage[]
      await expect(
        prepareChatMessages(messages, {
          attachments: collectFileAttachments(messages),
          nativeSupport: NONE,
          isToolCapable: true,
          signal: controller.signal
        })
      ).rejects.toMatchObject({ name: 'AbortError' })
      expect(mediaAnalysisMock).not.toHaveBeenCalled()
      expect(resolveMock).not.toHaveBeenCalled()
      expect(readMock).not.toHaveBeenCalled()
    })

    it('does not emit stored video/webm when audio-only WebM bytes cannot be read', async () => {
      materializerMode.real = true
      getByIdMock.mockResolvedValueOnce({ ext: 'webm' })
      probeMock.mockResolvedValueOnce(audioOnly)
      readMock.mockRejectedValueOnce(new Error('unreadable /private/secret/clip.webm'))

      const [out] = await run([fileWithEntry('e1', 'clip.webm', 'video/webm')], audioNative)

      const text = textOf(out.parts).join('\n')
      expect(text).toBe('Attached file "clip.webm": [could not read this file].')
      expect(text).not.toContain('video/webm')
      expect(text).not.toContain('/private/secret')
      expect(out.parts.some((part) => part.type === 'file')).toBe(false)
    })

    it('hides a WebM probe failure instead of inlining the error', async () => {
      getByIdMock.mockResolvedValueOnce({ ext: 'webm' })
      probeMock.mockRejectedValueOnce(new Error('ffprobe failed for /private/secret/clip.webm'))

      const [out] = await run([fileWithEntry('e1', 'clip.webm', 'video/webm')], NONE)

      const text = textOf(out.parts).join('\n')
      expect(probeMock).toHaveBeenCalledOnce()
      expect(text).toBe('Attached file "clip.webm": [could not read this file].')
      expect(text).not.toContain('/private/secret')
      expect(text).not.toContain('ffprobe')
      expect(mediaAnalysisMock).not.toHaveBeenCalled()
      expect(resolveMock).not.toHaveBeenCalled()
    })
  })

  it('notes a binary/unsupported file instead of garbage-decoding it', async () => {
    getByIdMock.mockResolvedValueOnce({ ext: 'zip' })
    extractMock.mockResolvedValueOnce(null)
    const [out] = await run([fileWithEntry('e1', 'a.zip', 'application/zip')], NONE)
    expect(textOf(out.parts)[0]).toBe(
      'Attached file "a.zip":\nCannot read the attached file "a.zip" as text (unsupported file type).'
    )
    expect(extractMock).toHaveBeenCalledWith('e1', { signal: undefined })
  })

  // An AVIF/HEIC image is accepted wildcard-style on the agent surface, yet no ext list
  // classifies it — the note above would drop the only usable reference to the file.
  it('keeps an unlisted-extension attachment as a file part for a path-forwarding caller', async () => {
    getByIdMock.mockResolvedValueOnce({ ext: 'avif' })
    const part = fileWithEntry('e1', 'photo.avif', 'image/avif')

    const [out] = await prepareChatMessages([userMessage([part])] as UIMessage[], {
      attachments: [{ fileEntryId: 'e1', handle: 'photo.avif', displayName: 'photo.avif' }],
      nativeSupport: ALL,
      isToolCapable: true,
      keepUnroutableFileParts: true
    })

    expect(out.parts).toEqual([part])
    expect(extractMock).not.toHaveBeenCalled()
  })

  it('degrades a native file to a note when materialization returns null', async () => {
    getByIdMock.mockResolvedValueOnce({ ext: 'png' })
    resolveMock.mockResolvedValueOnce(null)
    const [out] = await run([fileWithEntry('e1', 'a.png', 'image/png')], ALL)
    expect(out.parts.filter((p) => p.type === 'file')).toHaveLength(0)
    expect(textOf(out.parts)[0]).toBe('Attached file "a.png": [could not read this file].')
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

  // The cap used to be per file, so two attachments cost twice the cap and
  // nothing bounded a turn's total.
  it('splits one pool across the attachments of a turn instead of giving each the full cap', async () => {
    getByIdMock.mockResolvedValue({ ext: 'txt' })
    extractMock.mockResolvedValueOnce('a'.repeat(100)).mockResolvedValueOnce('b'.repeat(100))
    const [out] = await run(
      [fileWithEntry('e1', 'a.txt', 'text/plain'), fileWithEntry('e2', 'b.txt', 'text/plain')],
      NONE,
      { cap: 60 }
    )

    expect(textOf(out.parts)).toEqual([
      expect.stringContaining('[Truncated 30/100 chars'),
      expect.stringContaining('[Truncated 30/100 chars')
    ])
  })

  // The pool is drawn across every message, and each cap has to land back in the
  // message it came from — the routing pass runs them concurrently.
  it('shares the pool across messages and writes each cap back to its own message', async () => {
    getByIdMock.mockResolvedValue({ ext: 'txt' })
    extractMock.mockResolvedValueOnce('a'.repeat(100)).mockResolvedValueOnce('b'.repeat(20))
    const messages = [
      userMessage([fileWithEntry('e1', 'a.txt', 'text/plain')]),
      userMessage([fileWithEntry('e2', 'b.txt', 'text/plain')])
    ] as UIMessage[]

    const out = await prepareChatMessages(messages, {
      attachments: collectFileAttachments(messages),
      nativeSupport: NONE,
      isToolCapable: true,
      budget: { tokens: 60, tokenizer: charTokenizer }
    })

    // b.txt fits whole, so a.txt takes the 40 it leaves behind rather than half.
    expect(textOf(out[0].parts)[0]).toContain('[Truncated 40/100 chars')
    expect(textOf(out[1].parts)[0]).toBe(`Attached file "b.txt":\n${'b'.repeat(20)}`)
  })

  it('rethrows on abort instead of degrading', async () => {
    const controller = new AbortController()
    controller.abort()
    getByIdMock.mockRejectedValueOnce(new Error('aborted'))
    await expect(
      prepareChatMessages([userMessage([fileWithEntry('e1', 'a.pdf', 'application/pdf')])] as UIMessage[], {
        attachments: [{ fileEntryId: 'e1', handle: 'a.pdf', displayName: 'a.pdf' }],
        nativeSupport: NONE,
        isToolCapable: true,
        signal: controller.signal
      })
    ).rejects.toThrow()
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

  it.each([
    ['audio', 'wav', 'audio/wav'],
    ['video', 'mp4', 'video/mp4']
  ] as const)(
    'omits a normalized legacy %s part when the endpoint does not accept it',
    async (kind, ext, mediaType) => {
      resolveMock.mockResolvedValueOnce({ type: 'file', url: `data:${mediaType};base64,AA`, mediaType })
      const legacy = {
        type: 'file',
        url: `file:///x/legacy.${ext}`,
        mediaType: 'application/octet-stream'
      } as CherryMessagePart
      const [out] = await prepareChatMessages([userMessage([legacy])] as UIMessage[], {
        attachments: [],
        nativeSupport: NONE,
        isToolCapable: true
      })

      expect(getByIdMock).not.toHaveBeenCalled()
      expect(out.parts).toEqual([
        { type: 'text', text: `[${kind} attachment omitted: this model does not accept ${kind} input]` }
      ])
    }
  )

  it.each([
    ['audio', 'wav', 'audio/wav'],
    ['video', 'mp4', 'video/mp4']
  ] as const)('keeps a normalized legacy %s part when the endpoint accepts it', async (_kind, ext, mediaType) => {
    const materialized = { type: 'file', url: `data:${mediaType};base64,AA`, mediaType }
    resolveMock.mockResolvedValueOnce(materialized)
    const legacy = {
      type: 'file',
      url: `file:///x/legacy.${ext}`,
      mediaType: 'application/octet-stream'
    } as CherryMessagePart

    const [out] = await prepareChatMessages([userMessage([legacy])] as UIMessage[], {
      attachments: [],
      nativeSupport: ALL,
      isToolCapable: true
    })

    expect(getByIdMock).not.toHaveBeenCalled()
    expect(out.parts).toEqual([materialized])
  })
})

describe('collectFileAttachments', () => {
  it('flattens fileEntry attachments with unique handles, preserving the display name', () => {
    const messages = [
      userMessage([fileWithEntry('e1', 'report.pdf', 'application/pdf')]),
      userMessage([fileWithEntry('e2', 'report.pdf', 'application/pdf')])
    ] as UIMessage[]
    expect(collectFileAttachments(messages)).toEqual([
      { fileEntryId: 'e1', handle: 'report.pdf', displayName: 'report.pdf' },
      { fileEntryId: 'e2', handle: 'report.pdf (2)', displayName: 'report.pdf' }
    ])
  })

  it('disambiguates a generated alias that would collide with a real name', () => {
    const messages = [
      userMessage([fileWithEntry('e1', 'a.txt', 'text/plain')]),
      userMessage([fileWithEntry('e2', 'a.txt (2)', 'text/plain')]),
      userMessage([fileWithEntry('e3', 'a.txt', 'text/plain')])
    ] as UIMessage[]
    const handles = collectFileAttachments(messages).map((a) => a.handle)
    expect(handles).toEqual(['a.txt', 'a.txt (2)', 'a.txt (3)'])
    expect(new Set(handles).size).toBe(3)
  })

  it('ignores file parts without a fileEntryId', () => {
    const legacy = { type: 'file', url: 'file:///x/legacy.pdf', mediaType: 'application/pdf' } as CherryMessagePart
    expect(collectFileAttachments([userMessage([legacy])] as UIMessage[])).toEqual([])
  })

  it('ignores orphaned modern file parts but keeps matching and legacy attachments', () => {
    const messages = [
      userMessage([
        composerText('attached', 'live-source'),
        fileWithEntry('live', 'live.png', 'image/png', 'live-source'),
        fileWithEntry('stale', 'stale.png', 'image/png', 'stale-source'),
        fileWithEntry('legacy', 'legacy.png', 'image/png')
      ])
    ] as UIMessage[]

    expect(collectFileAttachments(messages)).toEqual([
      { fileEntryId: 'live', handle: 'live.png', displayName: 'live.png' },
      { fileEntryId: 'legacy', handle: 'legacy.png', displayName: 'legacy.png' }
    ])
  })
})
