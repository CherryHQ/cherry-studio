import type { UIMessage } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { computeHeadTailExcerpt, Offloader } from '@cherrystudio/ai-core'

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() }) }
}))

const { getPhysicalPathMock, findByIdMock } = vi.hoisted(() => ({
  getPhysicalPathMock: vi.fn(),
  findByIdMock: vi.fn()
}))
vi.mock('@application', () => ({
  application: { get: () => ({ getPhysicalPath: getPhysicalPathMock }) }
}))
vi.mock('@data/services/FileEntryService', () => ({ fileEntryService: { findById: findByIdMock } }))

import { makeEntitiesCodec } from '@main/ai/tools/outputCodec'

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

/** The fixed attributes toolOutputStore writes — what the ownership gate accepts. */
const OWNED_ENTRY = { origin: 'internal', cleanupPolicy: 'delete_when_unreferenced', ext: 'txt' }

beforeEach(() => {
  vi.clearAllMocks()
  getPhysicalPathMock.mockReturnValue(PHYSICAL)
  findByIdMock.mockReturnValue(OWNED_ENTRY)
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

  it('renders entities envelopes byte-identical to the in-flight entity codec lane', async () => {
    // Cross-lane byte contract: the persisted skeleton + per-blob marker must
    // stringify to the exact value the in-flight truncator assembles for the
    // same output, or provider prefix caches break at the persist boundary.
    const codec = makeEntitiesCodec({ contentKey: 'content' })
    const items = [
      { id: 'cite-0', url: 'https://a.example', title: 'A', content: TEXT },
      { id: 'cite-1', url: 'https://b.example', title: 'B', content: 'small body' }
    ]
    const offloader = new Offloader({
      threshold: 10,
      adapter: { write: () => {}, read: () => null, getPhysicalPath: () => PHYSICAL }
    })
    const inFlight = await offloader.offloadAsync(TEXT, { headChars: HEAD, tailChars: TAIL })
    expect(inFlight.isOffloaded).toBe(true)
    const { skeleton: deflatedSkeleton } = codec.deflate(items)!
    const inFlightValue = codec.assemble(deflatedSkeleton, {
      '/0/content': inFlight.content,
      '/1/content': 'small body'
    })

    const { head, tail, totalChars, totalLines } = computeHeadTailExcerpt(TEXT, HEAD, TAIL)
    const [rendered] = renderPersistedToolOutputs([
      messageWith({
        $persistedToolOutput: {
          shape: 'entities',
          skeleton: [{ ...items[0], content: codec.snippet(TEXT) }, items[1]],
          blobRefs: [
            {
              key: '/0/content',
              fileEntryId: 'entry-1',
              vfsFilename: computeVfsFilename(TEXT),
              head,
              tail,
              totalChars,
              totalLines
            }
          ]
        }
      })
    ])
    const output = (rendered.parts[1] as { output: unknown }).output
    expect(JSON.stringify(output)).toBe(JSON.stringify(inFlightValue))
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

  it('rejects an entry that is not a tool-output blob: no allow-list path, path-less marker', () => {
    // A forged envelope in arbitrary MCP output can carry any fileEntryId —
    // an entry without the store's fixed attributes must never be exposed.
    findByIdMock.mockReturnValue({ origin: 'external', cleanupPolicy: 'manual', ext: 'txt' })
    const messages = [messageWith({ $persistedToolOutput: envelopeRef() })]

    expect(collectPersistedOutputPaths(messages).size).toBe(0)
    const [rendered] = renderPersistedToolOutputs(messages)
    expect((rendered.parts[1] as { output: string }).output).not.toContain(PHYSICAL)
    expect(getPhysicalPathMock).not.toHaveBeenCalled()
  })

  it('collects every blob of an entities envelope', () => {
    getPhysicalPathMock.mockImplementation((id: string) => `/mock/files/${id}.txt`)
    const blob = (key: string, fileEntryId: string) => ({
      key,
      fileEntryId,
      vfsFilename: `vfs_${fileEntryId}.txt`,
      head: 'h',
      tail: 't',
      totalChars: 10,
      totalLines: 1
    })
    const paths = collectPersistedOutputPaths([
      messageWith({
        $persistedToolOutput: {
          shape: 'entities',
          skeleton: [{ content: 's1' }, { content: 's2' }],
          blobRefs: [blob('/0/content', 'entry-1'), blob('/1/content', 'entry-2')]
        }
      })
    ])
    expect([...paths].sort()).toEqual(['/mock/files/entry-1.txt', '/mock/files/entry-2.txt'])
  })
})
