import { MockMainFileManagerExport } from '@test-mocks/main/FileManager'
import type { UIMessage } from 'ai'
import { jsonSchema } from 'ai'
import { countTokens } from 'gpt-tokenizer/encoding/o200k_base'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { makeModel } from '@main/ai/__tests__/fixtures/model'
import { makeProvider } from '@main/ai/__tests__/fixtures/provider'
import type { TextTokenizer } from '@main/ai/tokens/textTokenizer'

const { extractMock } = vi.hoisted(() => ({
  extractMock: vi.fn<(entryId: string) => Promise<string | null>>()
}))
vi.mock('../attachmentTextExtraction', () => ({
  extractDocumentText: extractMock,
  noExtractableTextNote: (name: string) => `No text in ${name}`
}))
vi.mock('../fileProcessor', () => ({ materializeNativeFilePart: vi.fn() }))

import { collectFileAttachments, prepareChatMessages } from '../attachmentRouting'

const nativeSupport = { image: false, pdf: false, audio: false, video: false }

function messagesWithFiles(): UIMessage[] {
  return ['e1', 'e2'].map((id) => ({
    id,
    role: 'user',
    parts: [
      { type: 'text', text: `message ${id}` },
      {
        type: 'file',
        url: 'file:///x/report.txt',
        filename: 'report.txt',
        mediaType: 'text/plain',
        providerMetadata: { cherry: { fileEntryId: id } }
      }
    ]
  }))
}

async function loadWithEncoder(encoder: typeof countTokens): Promise<TextTokenizer> {
  vi.doMock('gpt-tokenizer/encoding/o200k_base', () => ({ countTokens: encoder }))
  vi.resetModules()
  const { loadGptO200kTokenizer } = await import('@main/ai/tokens/textTokenizer')
  return loadGptO200kTokenizer()
}

function inlineText(message: UIMessage): string {
  const part = message.parts[1]
  expect(part.type).toBe('text')
  if (part.type !== 'text') throw new Error('missing inline text')
  return part.text
}

beforeEach(() => {
  extractMock.mockReset()
  MockMainFileManagerExport.fileManager.getById.mockReset().mockResolvedValue({ ext: 'txt' })
})

afterEach(() => {
  vi.doUnmock('gpt-tokenizer/encoding/o200k_base')
  vi.resetModules()
})

describe('prepareChatMessages with real token budgeting', () => {
  it.each([false, true])('keeps a priced budget for system, history and tools (encoder fails: %s)', async (fails) => {
    await loadWithEncoder(
      fails
        ? () => {
            throw new Error('encoder failed')
          }
        : countTokens
    )
    const { resolveAttachmentBudget } = await import('../attachmentBudget')
    const system = fails ? '中' : 'A'.repeat(16_385)
    const history = fails ? 'history' : 'A'.repeat(16_385)
    const description = fails ? '😀' : '中'.repeat(16_385)
    const schema = { type: 'object' } as const
    const budget = await resolveAttachmentBudget({
      provider: makeProvider(),
      model: makeModel({ contextWindow: 100_000 }),
      system,
      tools: { read: { description, inputSchema: jsonSchema(schema) } },
      maxOutputTokens: 1_000,
      messages: [{ id: 'history', role: 'user', parts: [{ type: 'text', text: history }] }],
      mediaCapabilities: { image: false, audio: false, video: false }
    })
    const shortBudget = await resolveAttachmentBudget({
      provider: makeProvider(),
      model: makeModel({ contextWindow: 100_000 }),
      system: 'sys',
      tools: { read: { description: 'desc', inputSchema: jsonSchema(schema) } },
      maxOutputTokens: 1_000,
      messages: [{ id: 'history', role: 'user', parts: [{ type: 'text', text: 'hist' }] }],
      mediaCapabilities: { image: false, audio: false, video: false }
    })

    expect(budget).not.toBeNull()
    expect(budget?.tokenizer.id).toBe('gpt-tokenizer/o200k')
    expect(Number.isFinite(budget?.tokens)).toBe(true)
    expect(budget?.tokens).toBeGreaterThan(0)
    expect(budget?.tokens).toBeLessThan(89_100)
    expect(shortBudget).not.toBeNull()
    expect(budget!.tokens).toBeLessThan(shortBudget!.tokens)
    expect(budget?.tokens).toBeGreaterThanOrEqual(0)
  })

  it.each([true, false])('shares byte fallback across messages (tool capable: %s)', async (isToolCapable) => {
    const tokenizer = await loadWithEncoder(() => {
      throw new RangeError('Maximum call stack size exceeded')
    })
    const bodies = ['中😀hello', 'xyz'.repeat(8)]
    const messages = messagesWithFiles()
    const original = structuredClone(messages)
    extractMock.mockResolvedValueOnce(bodies[0]).mockResolvedValueOnce(bodies[1])

    const out = await prepareChatMessages(messages, {
      attachments: collectFileAttachments(messages),
      nativeSupport,
      isToolCapable,
      budget: { tokens: 16, tokenizer }
    })

    const heads = [bodies[0].slice(0, 4), bodies[1].slice(0, 8)]
    const handles = ['report.txt', 'report.txt (2)']
    let spent = 0
    heads.forEach((head, i) => {
      const cost = new TextEncoder().encode(head).length
      expect(cost).toBeLessThanOrEqual(8)
      spent += cost
      const continuation = isToolCapable
        ? ` — call read_file("${handles[i]}", offset=${head.length}) for the rest.`
        : '.'
      expect(inlineText(out[i])).toBe(
        `Attached file "${handles[i]}":\n${head}\n\n[Truncated ${head.length}/${bodies[i].length} chars${continuation}]`
      )
      expect(out[i].parts[0]).toEqual(original[i].parts[0])
    })
    expect(spent).toBeLessThanOrEqual(16)
    expect(spent).toBeGreaterThan(0)
    expect(messages).toEqual(original)
  })

  it('redistributes by size even when the smaller extraction finishes last', async () => {
    const tokenizer = await loadWithEncoder(() => {
      throw new Error('encoder failed')
    })
    const bodies = ['short', '中'.repeat(12)]
    const messages = messagesWithFiles()
    let finishSmall!: (body: string) => void
    let finishLarge!: (body: string) => void
    const small = new Promise<string>((resolve) => {
      finishSmall = resolve
    })
    const large = new Promise<string>((resolve) => {
      finishLarge = resolve
    })
    extractMock.mockImplementation((id) => (id === 'e1' ? small : large))

    const preparing = prepareChatMessages(messages, {
      attachments: collectFileAttachments(messages),
      nativeSupport,
      isToolCapable: true,
      budget: { tokens: 14, tokenizer }
    })
    await vi.waitFor(() => expect(extractMock).toHaveBeenCalledTimes(2))
    finishLarge(bodies[1])
    await large
    finishSmall(bodies[0])
    const out = await preparing

    expect(inlineText(out[0])).toBe('Attached file "report.txt":\nshort')
    expect(inlineText(out[1])).toBe(
      'Attached file "report.txt (2)":\n中中中\n\n[Truncated 3/12 chars — call read_file("report.txt (2)", offset=3) for the rest.]'
    )
    expect(new TextEncoder().encode(bodies[0] + '中中中').length).toBeLessThanOrEqual(14)
  })

  it('contains a dependency failure during the shorter search candidate', async () => {
    const body = '中'.repeat(16)
    const candidate = body.slice(0, 8)
    const encoder = vi.fn<typeof countTokens>((text, options) => {
      if (text === candidate) throw new Error('search candidate failed')
      return countTokens(text, options)
    })
    const tokenizer = await loadWithEncoder(encoder)
    extractMock.mockResolvedValueOnce(body)
    const messages = messagesWithFiles().slice(0, 1)
    const original = structuredClone(messages)

    const [out] = await prepareChatMessages(messages, {
      attachments: collectFileAttachments(messages),
      nativeSupport,
      isToolCapable: true,
      budget: { tokens: 8, tokenizer }
    })

    expect(encoder).toHaveBeenCalledWith(candidate, { disallowedSpecial: new Set() })
    const head = '中'.repeat(7)
    expect(countTokens(head, { disallowedSpecial: new Set() })).toBeLessThanOrEqual(8)
    expect(inlineText(out)).toBe(
      `Attached file "report.txt":\n${head}\n\n[Truncated 7/16 chars — call read_file("report.txt", offset=7) for the rest.]`
    )
    expect(messages).toEqual(original)
  })

  it('rechecks the higher byte price when final verification fails after a successful candidate', async () => {
    const body = '中'.repeat(16)
    const candidate = body.slice(0, 8)
    let candidateCounts = 0
    const encoder = vi.fn<typeof countTokens>((text, options) => {
      if (text === candidate && ++candidateCounts === 2) throw new RangeError('final verification failed')
      return countTokens(text, options)
    })
    const tokenizer = await loadWithEncoder(encoder)
    extractMock.mockResolvedValueOnce(body)
    const messages = messagesWithFiles().slice(0, 1)

    const [out] = await prepareChatMessages(messages, {
      attachments: collectFileAttachments(messages),
      nativeSupport,
      isToolCapable: true,
      budget: { tokens: 8, tokenizer }
    })

    expect(candidateCounts).toBe(2)
    const head = '中'.repeat(4)
    expect(countTokens(head, { disallowedSpecial: new Set() })).toBeLessThanOrEqual(8)
    expect(inlineText(out)).toBe(
      `Attached file "report.txt":\n${head}\n\n[Truncated 4/16 chars — call read_file("report.txt", offset=4) for the rest.]`
    )
  })
})
