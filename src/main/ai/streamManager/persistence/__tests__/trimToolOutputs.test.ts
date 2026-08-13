import type { CherryMessagePart } from '@shared/data/types/message'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() }) }
}))

const { prefsGetMock, persistMock, registryGetAllMock } = vi.hoisted(() => ({
  prefsGetMock: vi.fn(),
  persistMock: vi.fn(),
  registryGetAllMock: vi.fn(() => [] as Array<{ name: string; truncatable?: boolean; codec?: unknown }>)
}))
vi.mock('@application', () => ({
  application: { get: (name: string) => (name === 'PreferenceService' ? { get: prefsGetMock } : {}) }
}))
vi.mock('@main/ai/contextBuild/toolOutputStore', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  persistToolOutputText: persistMock
}))
vi.mock('@main/ai/tools/adapters/aiSdk/registry', () => ({
  registry: { getAll: registryGetAllMock }
}))

import { makeEntitiesCodec, makeTextFieldCodec } from '@main/ai/tools/outputCodec'

import { trimOversizedToolOutputs } from '../trimToolOutputs'

const THRESHOLD = 2_000
const BIG = Array.from({ length: 200 }, (_, i) => `line ${i + 1} — some longer padding text here`).join('\n')

const toolPart = (output: unknown, overrides: Record<string, unknown> = {}): CherryMessagePart =>
  ({
    type: 'tool-run_cmd',
    toolCallId: 'call-1',
    state: 'output-available',
    input: {},
    output,
    ...overrides
  }) as unknown as CherryMessagePart

const ENTRY = { id: 'entry-1', origin: 'internal', cleanupPolicy: 'delete_when_unreferenced', ext: 'txt' }

beforeEach(() => {
  vi.clearAllMocks()
  prefsGetMock.mockImplementation((key: string) => {
    if (key === 'chat.context_settings.enabled') return true
    if (key === 'chat.context_settings.truncate_threshold') return THRESHOLD
    // resolveGlobalContextSettings reads every context key; max_messages and
    // compress.* are unused by the trim gate but must resolve without throwing.
    if (key === 'chat.context_settings.max_messages') return null
    if (key === 'chat.context_settings.compress.enabled') return true
    if (key === 'chat.context_settings.compress.model_id') return null
    throw new Error(`unexpected pref ${key}`)
  })
  registryGetAllMock.mockReturnValue([])
  persistMock.mockResolvedValue({ entry: ENTRY, vfsFilename: 'vfs_0123456789abcdef.txt' })
})

describe('trimOversizedToolOutputs', () => {
  it('replaces an oversized string output with a persisted envelope', async () => {
    const parts = [toolPart(BIG)]
    const [trimmed] = await trimOversizedToolOutputs(parts)

    expect(persistMock).toHaveBeenCalledWith(BIG)
    const output = (trimmed as { output: unknown }).output as {
      $persistedToolOutput: Record<string, unknown>
    }
    expect(output.$persistedToolOutput).toMatchObject({
      fileEntryId: 'entry-1',
      vfsFilename: 'vfs_0123456789abcdef.txt',
      totalChars: BIG.length,
      shape: 'text'
    })
    expect((output.$persistedToolOutput.head as string).length).toBeGreaterThan(0)
    expect((output.$persistedToolOutput.tail as string).length).toBeGreaterThan(0)
    expect(BIG.startsWith(output.$persistedToolOutput.head as string)).toBe(true)
    expect(BIG.endsWith(output.$persistedToolOutput.tail as string)).toBe(true)
  })

  it('keeps the metadata of an all-text MCP output on the envelope', async () => {
    const metadata = { serverId: 's1', serverName: 'files', type: 'mcp' }
    const parts = [toolPart({ content: [{ type: 'text', text: BIG }], metadata })]
    const [trimmed] = await trimOversizedToolOutputs(parts)
    const output = (trimmed as { output: unknown }).output as { $persistedToolOutput: Record<string, unknown> }
    expect(output.$persistedToolOutput).toMatchObject({ shape: 'mcp-content', metadata })
  })

  it.each([
    ['under threshold', [toolPart('short output')]],
    ['non-terminal part', [toolPart(BIG, { state: 'input-available' })]],
    ['ineligible structured output', [toolPart({ giant: BIG })]],
    [
      'already persisted',
      [
        toolPart({
          $persistedToolOutput: {
            fileEntryId: 'e',
            vfsFilename: 'v',
            head: '',
            tail: '',
            totalChars: 1,
            totalLines: 1,
            shape: 'text'
          }
        })
      ]
    ],
    ['already deferred', [toolPart({ $deferredToolResult: { topicId: 't', messageId: 'm', toolCallId: 'c' } })]],
    ['non-tool part', [{ type: 'text', text: BIG } as unknown as CherryMessagePart]]
  ])('passes through untouched: %s', async (_label, parts) => {
    const result = await trimOversizedToolOutputs(parts)
    expect(result).toBe(parts)
    expect(persistMock).not.toHaveBeenCalled()
  })

  it('honours truncatable:false registry entries', async () => {
    registryGetAllMock.mockReturnValue([
      { name: 'run_cmd', truncatable: false },
      { name: 'other', truncatable: undefined }
    ])
    const parts = [toolPart(BIG)]
    expect(await trimOversizedToolOutputs(parts)).toBe(parts)
    expect(persistMock).not.toHaveBeenCalled()
  })

  it('is disabled together with the context-build feature', async () => {
    prefsGetMock.mockImplementation((key: string) => key !== 'chat.context_settings.enabled')
    const parts = [toolPart(BIG)]
    expect(await trimOversizedToolOutputs(parts)).toBe(parts)
    expect(persistMock).not.toHaveBeenCalled()
  })

  it('keeps the full output when storage fails (never trade data for a marker)', async () => {
    persistMock.mockRejectedValue(new Error('disk full'))
    const parts = [toolPart(BIG)]
    const result = await trimOversizedToolOutputs(parts)
    expect((result[0] as { output: unknown }).output).toBe(BIG)
  })

  it('trims only the oversized parts of a mixed array', async () => {
    const small = toolPart('small', { toolCallId: 'call-2' })
    const result = await trimOversizedToolOutputs([toolPart(BIG), small])
    expect((result[0] as { output: { $persistedToolOutput?: unknown } }).output.$persistedToolOutput).toBeDefined()
    expect(result[1]).toBe(small)
  })

  describe('codec lane', () => {
    const codec = makeEntitiesCodec({ contentKey: 'content' })
    const items = [
      { id: 'cite-0', url: 'https://a.example', title: 'A', content: BIG },
      { id: 'cite-1', url: 'https://b.example', title: 'B', content: 'small body' }
    ]

    it('blobs each oversized entity field and keeps a snippet in the skeleton', async () => {
      registryGetAllMock.mockReturnValue([{ name: 'run_cmd', codec }])
      const [trimmed] = await trimOversizedToolOutputs([toolPart(items)])

      expect(persistMock).toHaveBeenCalledTimes(1)
      expect(persistMock).toHaveBeenCalledWith(BIG)
      const ref = (trimmed as { output: { $persistedToolOutput: Record<string, unknown> } }).output.$persistedToolOutput
      expect(ref.shape).toBe('entities')
      const blobRefs = ref.blobRefs as Array<Record<string, unknown>>
      expect(blobRefs).toHaveLength(1)
      expect(blobRefs[0]).toMatchObject({
        key: '/0/content',
        fileEntryId: 'entry-1',
        vfsFilename: 'vfs_0123456789abcdef.txt',
        totalChars: BIG.length
      })
      expect(BIG.startsWith(blobRefs[0].head as string)).toBe(true)
      expect(BIG.endsWith(blobRefs[0].tail as string)).toBe(true)

      const skeleton = ref.skeleton as Array<Record<string, unknown>>
      expect(skeleton[0].content).toBe(codec.snippet(BIG))
      expect(skeleton[0]).toMatchObject({ id: 'cite-0', url: 'https://a.example', title: 'A' })
      // The under-threshold entity keeps its full text (same object reference).
      expect(skeleton[1]).toBe(items[1])
    })

    it('applies even when the tool is truncatable:false (persist-only echo trim)', async () => {
      registryGetAllMock.mockReturnValue([{ name: 'run_cmd', truncatable: false, codec }])
      const [trimmed] = await trimOversizedToolOutputs([toolPart(items)])
      const ref = (trimmed as { output: { $persistedToolOutput: Record<string, unknown> } }).output.$persistedToolOutput
      expect(ref.shape).toBe('entities')
    })

    it.each([
      ['deflate → null (unrecognized shape)', { error: 'nope' }],
      ['nothing over the threshold', [{ id: 'cite-0', url: 'https://a.example', title: 'A', content: 'small' }]]
    ])('passes through untouched: %s', async (_label, output) => {
      registryGetAllMock.mockReturnValue([{ name: 'run_cmd', codec }])
      const parts = [toolPart(output)]
      expect(await trimOversizedToolOutputs(parts)).toBe(parts)
      expect(persistMock).not.toHaveBeenCalled()
    })

    it('keeps the full output when blob storage fails', async () => {
      registryGetAllMock.mockReturnValue([{ name: 'run_cmd', codec }])
      persistMock.mockRejectedValue(new Error('disk full'))
      const result = await trimOversizedToolOutputs([toolPart(items)])
      expect((result[0] as { output: unknown }).output).toBe(items)
    })
  })

  describe('fs_read echo boundary (truncatable:false + text-field codec)', () => {
    // fs_read caps its output at READ_OUTPUT_CHAR_CAP == the persist
    // threshold, so with the strict `>` gate the persist codec never fires at
    // the default configuration — only a lowered threshold trims the echo.
    const codec = makeTextFieldCodec({ textKey: 'text' })
    const fsOutput = (text: string) => ({ kind: 'text', text, startLine: 1, endLine: 42, totalLines: 42 })

    beforeEach(() => {
      registryGetAllMock.mockReturnValue([{ name: 'run_cmd', truncatable: false, codec }])
    })

    it('does not trim an echo exactly at the threshold (the default cap case)', async () => {
      const parts = [toolPart(fsOutput('x'.repeat(THRESHOLD)))]
      expect(await trimOversizedToolOutputs(parts)).toBe(parts)
      expect(persistMock).not.toHaveBeenCalled()
    })

    it('blobs an echo one char over the threshold, paging fields riding the skeleton', async () => {
      const text = 'x'.repeat(THRESHOLD + 1)
      const [trimmed] = await trimOversizedToolOutputs([toolPart(fsOutput(text))])

      expect(persistMock).toHaveBeenCalledWith(text)
      const ref = (trimmed as { output: { $persistedToolOutput: Record<string, unknown> } }).output.$persistedToolOutput
      expect(ref.shape).toBe('entities')
      expect(ref.blobRefs).toMatchObject([{ key: '/text', fileEntryId: 'entry-1', totalChars: text.length }])
      expect(ref.skeleton).toMatchObject({ kind: 'text', text: codec.snippet(text), startLine: 1, totalLines: 42 })
    })

    it('leaves error results untouched (deflate → null)', async () => {
      const parts = [toolPart({ kind: 'error', code: 'not-found', message: 'x'.repeat(THRESHOLD * 2) })]
      expect(await trimOversizedToolOutputs(parts)).toBe(parts)
      expect(persistMock).not.toHaveBeenCalled()
    })
  })

  describe('assistant override (P2-D)', () => {
    // Global threshold is THRESHOLD (2000) and BIG is ~9000 chars.
    it('does not trim when the assistant raises the threshold above the output size', async () => {
      const parts = [toolPart(BIG)]
      expect(await trimOversizedToolOutputs(parts, { truncateThreshold: 1_000_000 })).toBe(parts)
      expect(persistMock).not.toHaveBeenCalled()
    })

    it('trims at the assistant threshold when it is lower than the output size', async () => {
      const mid = 'x'.repeat(1800)
      // 1800 < global 2000 (no trim normally) but > head+tail floor(1500) and > assistant 400.
      const [trimmed] = await trimOversizedToolOutputs([toolPart(mid)], { truncateThreshold: 400 })
      expect(persistMock).toHaveBeenCalledWith(mid)
      expect((trimmed as { output: { $persistedToolOutput?: unknown } }).output.$persistedToolOutput).toBeDefined()
    })

    it('skips entirely when the assistant disables context build', async () => {
      const parts = [toolPart(BIG)]
      expect(await trimOversizedToolOutputs(parts, { enabled: false })).toBe(parts)
      expect(persistMock).not.toHaveBeenCalled()
    })

    it('inherits the global threshold when the override is null', async () => {
      const [trimmed] = await trimOversizedToolOutputs([toolPart(BIG)], null)
      expect((trimmed as { output: { $persistedToolOutput?: unknown } }).output.$persistedToolOutput).toBeDefined()
    })
  })
})
