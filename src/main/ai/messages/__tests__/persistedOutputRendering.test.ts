import { computeHeadTailExcerpt, Offloader } from '@cherrystudio/ai-core'
import type { UIMessage } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() }) }
}))

const { getPhysicalPathMock } = vi.hoisted(() => ({ getPhysicalPathMock: vi.fn() }))
vi.mock('@application', () => ({
  application: { get: () => ({ getPhysicalPath: getPhysicalPathMock }) }
}))

import { computeVfsFilename } from '../../contextBuild/toolOutputStore'
import { collectPersistedOutputPaths, renderPersistedToolOutputs } from '../persistedOutputRendering'

const HEAD = 500
const TAIL = 1000
const TEXT = Array.from({ length: 300 }, (_, i) => `output line ${i + 1} with plenty of padding text`).join('\n')
const PHYSICAL = '/mock/files/entry-1.txt'

function envelopeRef() {
  const { head, tail, totalChars, totalLines } = computeHeadTailExcerpt(TEXT, HEAD, TAIL)
  return {
    fileEntryId: 'entry-1',
    vfsFilename: computeVfsFilename(TEXT),
    head,
    tail,
    totalChars,
    totalLines,
    shape: 'text' as const
  }
}

function messageWith(output: unknown): UIMessage {
  return {
    id: 'm1',
    role: 'assistant',
    parts: [
      { type: 'text', text: 'ran a tool' },
      { type: 'tool-run_cmd', toolCallId: 'call-1', state: 'output-available', input: {}, output }
    ]
  } as unknown as UIMessage
}

beforeEach(() => {
  vi.clearAllMocks()
  getPhysicalPathMock.mockReturnValue(PHYSICAL)
})

describe('renderPersistedToolOutputs', () => {
  it('renders the byte-identical marker the in-flight offloader produces for the same content', async () => {
    // The contract that keeps provider prefix caches warm across the
    // in-flight → persisted boundary: same content + same path ⇒ same bytes.
    const offloader = new Offloader({
      threshold: 10,
      adapter: {
        write: () => {},
        read: () => null,
        getPhysicalPath: () => PHYSICAL
      }
    })
    const inFlight = await offloader.offloadAsync(TEXT, { headChars: HEAD, tailChars: TAIL })

    const [rendered] = renderPersistedToolOutputs([messageWith({ $persistedToolOutput: envelopeRef() })])
    const output = (rendered.parts[1] as { output: unknown }).output

    expect(inFlight.isOffloaded).toBe(true)
    expect(output).toBe(inFlight.content)
  })

  it('wraps the marker in an MCP content envelope for mcp-content shapes', () => {
    const metadata = { serverId: 's1' }
    const [rendered] = renderPersistedToolOutputs([
      messageWith({ $persistedToolOutput: { ...envelopeRef(), shape: 'mcp-content', metadata } })
    ])
    const output = (rendered.parts[1] as { output: unknown }).output as {
      content: Array<{ type: string; text: string }>
      metadata: unknown
    }
    expect(output.metadata).toEqual(metadata)
    expect(output.content).toHaveLength(1)
    expect(output.content[0].type).toBe('text')
    expect(output.content[0].text).toContain('<persisted-output>')
    expect(output.content[0].text).toContain(PHYSICAL)
  })

  it('renders a path-less marker when the entry is gone, keeping state output-available', () => {
    getPhysicalPathMock.mockImplementation(() => {
      throw new Error('entry reclaimed')
    })
    const [rendered] = renderPersistedToolOutputs([messageWith({ $persistedToolOutput: envelopeRef() })])
    const part = rendered.parts[1] as { state: string; output: string }
    expect(part.state).toBe('output-available')
    expect(part.output).toContain('Full output: context://vfs/')
    expect(part.output).not.toContain('Full output saved to:')
  })

  it('returns the same references when no part carries an envelope', () => {
    const messages = [messageWith('plain output')]
    expect(renderPersistedToolOutputs(messages)).toBe(messages)
  })
})

describe('collectPersistedOutputPaths', () => {
  it('collects resolvable blob paths and skips unresolvable ones', () => {
    getPhysicalPathMock.mockReturnValueOnce(PHYSICAL).mockImplementationOnce(() => {
      throw new Error('gone')
    })
    const paths = collectPersistedOutputPaths([
      messageWith({ $persistedToolOutput: envelopeRef() }),
      messageWith({ $persistedToolOutput: { ...envelopeRef(), fileEntryId: 'entry-2' } })
    ])
    expect([...paths]).toEqual([PHYSICAL])
  })

  it('returns an empty set for plain histories', () => {
    expect(collectPersistedOutputPaths([messageWith('plain')]).size).toBe(0)
  })
})
