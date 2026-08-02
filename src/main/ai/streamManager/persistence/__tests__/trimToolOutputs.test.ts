import type { CherryMessagePart } from '@shared/data/types/message'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() }) }
}))

const { prefsGetMock, persistMock, registryGetAllMock } = vi.hoisted(() => ({
  prefsGetMock: vi.fn(),
  persistMock: vi.fn(),
  registryGetAllMock: vi.fn(() => [] as Array<{ name: string; truncatable?: boolean }>)
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
})
