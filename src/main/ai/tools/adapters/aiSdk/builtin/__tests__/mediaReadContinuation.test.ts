import type { UIMessage } from 'ai'
import { describe, expect, it, vi } from 'vitest'

import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import { MEDIA_ANALYSIS_VERSION, type MediaAnalysis } from '@shared/types/mediaAnalysis'
import { formatMediaAnalysisCompact, formatMediaAnalysisFull } from '@shared/utils/mediaAnalysis'

const { getByIdMock, analyzeToCompactText, analyzeToFullText, extractMock } = vi.hoisted(() => ({
  getByIdMock: vi.fn<(id: string) => Promise<{ ext: string | null }>>(),
  analyzeToCompactText: vi.fn<(file: { kind: 'entry'; entryId: string }, signal?: AbortSignal) => Promise<string>>(),
  analyzeToFullText: vi.fn<(file: { kind: 'entry'; entryId: string }, signal?: AbortSignal) => Promise<string>>(),
  extractMock: vi.fn<(entryId: string) => Promise<string | null>>()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const mocked = mockApplicationFactory({
    FileManager: { getById: getByIdMock }
  })
  const delegated = mocked.application.get.getMockImplementation()
  mocked.application.get.mockImplementation((name: string) => {
    if (name === 'MediaAnalysisService') return { analyzeToCompactText, analyzeToFullText }
    return delegated?.call(mocked.application, name)
  })
  return mocked
})

vi.mock('@main/ai/messages/attachmentTextExtraction', () => ({
  extractDocumentText: extractMock,
  noExtractableTextNote: (name: string) => `No text in ${name}`
}))

import { collectFileAttachments, prepareChatMessages } from '@main/ai/messages/attachmentRouting'
import { readFile } from '@main/ai/tools/adapters/aiSdk/builtin/ReadFileTool'

const NONE = { image: false, pdf: false, audio: false, video: false }
const charTokenizer = { id: 'chars', count: (text: string) => text.length }
const FACT = 'MIDDLE_TRANSCRIPT_FACT'

function userMessage(parts: CherryMessagePart[]): CherryUIMessage {
  return { id: 'm1', role: 'user', parts }
}

function filePart(id: string, filename: string, mediaType: string): CherryMessagePart {
  return {
    type: 'file',
    url: `file:///x/${filename}`,
    mediaType,
    filename,
    providerMetadata: { cherry: { fileEntryId: id } }
  }
}

function longAnalysis(): MediaAnalysis {
  return {
    version: MEDIA_ANALYSIS_VERSION,
    source: { mime: 'video/mp4', durationMs: 40_000, hasAudio: true, hasVideo: true },
    audio: {
      segments: Array.from({ length: 40 }, (_, index) => ({
        startMs: index * 1_000,
        endMs: index * 1_000 + 400,
        text:
          index === 12 ? `${FACT} spoken in the middle of the transcript` : `spoken line ${index} ${'pad '.repeat(12)}`
      }))
    },
    visuals: Array.from({ length: 24 }, (_, index) => ({
      timestampMs: index * 1_000,
      summary: `scene ${index} ${'visual '.repeat(8)}`,
      ocrText: `ocr ${index} ${'screen '.repeat(8)}`
    })),
    warnings: []
  }
}

describe('media full-text continuation', () => {
  it('reaches every full-text range omitted from the compact attachment notice', async () => {
    const analysis = longAnalysis()
    const compact = formatMediaAnalysisCompact(analysis, { maxChars: 1_800 })
    const full = formatMediaAnalysisFull(analysis)
    const factAt = full.indexOf(FACT)

    expect(compact).not.toContain(FACT)
    expect(factAt).toBeGreaterThan(0)
    expect(factAt).toBeLessThan(compact.length)
    expect(full.slice(compact.length)).not.toContain(FACT)

    getByIdMock.mockResolvedValue({ ext: 'mp4' })
    analyzeToCompactText.mockResolvedValue(compact)
    analyzeToFullText.mockResolvedValue(full)
    const messages = [userMessage([filePart('e1', 'clip.mp4', 'video/mp4')])] as UIMessage[]
    const [prepared] = await prepareChatMessages(messages, {
      attachments: collectFileAttachments(messages),
      nativeSupport: NONE,
      isToolCapable: true,
      budget: { tokens: 120, tokenizer: charTokenizer }
    })
    const notice = prepared.parts.find((part) => part.type === 'text' && part.text.includes('read_file'))
    const advertised = Number(/offset=(\d+)/.exec(notice && notice.type === 'text' ? notice.text : '')?.[1])

    expect(advertised).toBe(0)

    let offset = advertised
    let combined = ''
    const pages: string[] = []
    for (let step = 0; step < 20; step += 1) {
      const page = await readFile(
        { filename: 'clip.mp4', offset, limit: 700 },
        {
          attachments: [{ fileEntryId: 'e1', handle: 'clip.mp4', displayName: 'clip.mp4' }]
        }
      )
      if ('error' in page) throw new Error(page.error)
      pages.push(page.text)
      combined += page.text
      if (page.nextOffset == null) break
      expect(page.nextOffset).toBeGreaterThan(offset)
      offset = page.nextOffset
    }

    expect(pages.length).toBeGreaterThan(1)
    expect(combined).toBe(full)
    expect(pages.some((page) => page.includes(FACT))).toBe(true)
    expect(pages[0]?.includes(FACT) || pages[1]?.includes(FACT)).toBe(true)
  })

  it('keeps a non-media truncation offset at the extracted prefix', async () => {
    getByIdMock.mockResolvedValue({ ext: 'txt' })
    extractMock.mockResolvedValue('0123456789')
    const messages = [userMessage([filePart('e1', 'a.txt', 'text/plain')])] as UIMessage[]
    const [prepared] = await prepareChatMessages(messages, {
      attachments: collectFileAttachments(messages),
      nativeSupport: NONE,
      isToolCapable: true,
      budget: { tokens: 5, tokenizer: charTokenizer }
    })
    const text = prepared.parts.find((part) => part.type === 'text')
    expect(text && text.type === 'text' ? text.text : '').toContain('read_file("a.txt", offset=5)')
  })
})
