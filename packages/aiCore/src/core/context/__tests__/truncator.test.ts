import type { LanguageModelV3Prompt } from '@ai-sdk/provider'
import { describe, expect, it, vi } from 'vitest'

import { Offloader, type VFSStorageAdapter } from '../offloader'
import { type EntityToolOutputCodec, truncateToolResults } from '../truncator'

describe('truncateToolResults', () => {
  const makeToolPrompt = (output: string): LanguageModelV3Prompt => [
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'call_1',
          toolName: 'run_cmd',
          output: { type: 'text', value: output }
        }
      ]
    }
  ]

  it('passes through content below threshold', async () => {
    const prompt = makeToolPrompt('short output')
    const result = await truncateToolResults(prompt, { threshold: 100 })
    expect(result).toEqual(prompt)
  })

  it('truncates content above threshold', async () => {
    const longOutput = 'line\n'.repeat(500)
    const prompt = makeToolPrompt(longOutput)
    const result = await truncateToolResults(prompt, {
      threshold: 100,
      headChars: 20,
      tailChars: 20
    })

    if (result[0].role === 'tool') {
      const part = result[0].content[0]
      if (part.type === 'tool-result' && part.output.type === 'text') {
        expect(part.output.value.length).toBeLessThan(longOutput.length)
        expect(part.output.value).toContain('truncated')
        expect(part.output.value).toContain('lines')
      }
    }
  })

  it('does not truncate when headChars + tailChars >= content length', async () => {
    const prompt = makeToolPrompt('small')
    const result = await truncateToolResults(prompt, {
      threshold: 2,
      headChars: 3,
      tailChars: 3
    })
    expect(result).toEqual(prompt)
  })

  it('never re-truncates an already-persisted marker, even below a tiny threshold', async () => {
    // A marker (head + <persisted-output> block + tail) larger than the
    // configured threshold must pass through untouched — re-offloading it
    // would produce a marker pointing at a marker.
    const marker = [
      'head line\n'.repeat(30),
      '<persisted-output>\noutput truncated (500 lines, 9999 chars total)\nFull output saved to: /tmp/vfs_abc.txt\n</persisted-output>\n',
      'tail line\n'.repeat(30)
    ].join('')
    const prompt = makeToolPrompt(marker)
    const result = await truncateToolResults(prompt, { threshold: 50, headChars: 10, tailChars: 10 })
    expect(result).toEqual(prompt)
  })

  it('does not affect non-tool messages', async () => {
    const prompt: LanguageModelV3Prompt = [
      { role: 'system', content: 'x'.repeat(200) },
      { role: 'user', content: [{ type: 'text', text: 'x'.repeat(200) }] }
    ]
    const result = await truncateToolResults(prompt, { threshold: 10 })
    expect(result).toEqual(prompt)
  })

  it('handles json tool output', async () => {
    const bigJson = JSON.stringify({ data: 'x'.repeat(500) })
    const prompt: LanguageModelV3Prompt = [
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call_1',
            toolName: 'query',
            output: { type: 'json', value: { data: 'x'.repeat(500) } }
          }
        ]
      }
    ]
    const result = await truncateToolResults(prompt, {
      threshold: 100,
      headChars: 20,
      tailChars: 20
    })

    if (result[0].role === 'tool') {
      const part = result[0].content[0]
      if (part.type === 'tool-result') {
        expect(part.output.type).toBe('text')
        if (part.output.type === 'text') {
          expect(part.output.value.length).toBeLessThan(bigJson.length)
        }
      }
    }
  })

  it('preserves head and tail content', async () => {
    const output = `HEAD_CONTENT${'_'.repeat(500)}TAIL_CONTENT`
    const prompt = makeToolPrompt(output)
    const result = await truncateToolResults(prompt, {
      threshold: 50,
      headChars: 12,
      tailChars: 12
    })

    if (result[0].role === 'tool') {
      const part = result[0].content[0]
      if (part.type === 'tool-result' && part.output.type === 'text') {
        expect(part.output.value).toContain('HEAD_CONTENT')
        expect(part.output.value).toContain('TAIL_CONTENT')
      }
    }
  })

  it('saves original to storage adapter and includes URI', async () => {
    const stored: Record<string, string> = {}
    const mockStorage: VFSStorageAdapter = {
      write(filename: string, content: string) {
        stored[filename] = content
      },
      read(filename: string) {
        return stored[filename] ?? null
      }
    }

    // Use a content size large enough that the marker overhead (path,
    // wrapper, descriptor) cannot exceed the original — otherwise the
    // toBeLessThan assertion is environment-sensitive (CI's tempdir paths
    // are longer than typical local paths).
    const longOutput = 'x'.repeat(5000)
    const prompt = makeToolPrompt(longOutput)
    const result = await truncateToolResults(prompt, {
      threshold: 50,
      headChars: 10,
      tailChars: 10,
      storage: mockStorage
    })

    // Original should be stored
    const storedFiles = Object.keys(stored)
    expect(storedFiles).toHaveLength(1)
    expect(stored[storedFiles[0]]).toBe(longOutput)

    // Truncated output should contain URI
    if (result[0].role === 'tool') {
      const part = result[0].content[0]
      if (part.type === 'tool-result' && part.output.type === 'text') {
        expect(part.output.value).toContain('context://vfs/')
        expect(part.output.value.length).toBeLessThan(longOutput.length)
      }
    }
  })

  it('preserves a tool listed by name (string entry) and bypasses storage', async () => {
    const stored: Record<string, string> = {}
    const mockStorage: VFSStorageAdapter = {
      write(filename: string, content: string) {
        stored[filename] = content
      },
      read(filename: string) {
        return stored[filename] ?? null
      }
    }

    const longOutput = 'x'.repeat(500)
    const prompt = makeToolPrompt(longOutput) // toolName: 'run_cmd'
    const result = await truncateToolResults(prompt, {
      threshold: 50,
      headChars: 10,
      tailChars: 10,
      storage: mockStorage,
      perTool: ['run_cmd']
    })

    expect(result).toEqual(prompt)
    expect(Object.keys(stored)).toHaveLength(0)
  })

  it('respects per-tool threshold override', async () => {
    const longOutput = 'x'.repeat(500)
    const prompt = makeToolPrompt(longOutput)
    const result = await truncateToolResults(prompt, {
      threshold: 100,
      headChars: 10,
      tailChars: 10,
      perTool: [{ name: 'run_cmd', threshold: 1000 }]
    })

    // Bumped threshold above content length → no truncation
    expect(result).toEqual(prompt)
  })

  it('respects per-tool tailChars override', async () => {
    const output = `${'A'.repeat(200)}TAIL_MARKER`
    const prompt = makeToolPrompt(output)
    const result = await truncateToolResults(prompt, {
      threshold: 50,
      headChars: 0,
      tailChars: 5,
      perTool: [{ name: 'run_cmd', tailChars: 50 }]
    })

    if (result[0].role === 'tool') {
      const part = result[0].content[0]
      if (part.type === 'tool-result' && part.output.type === 'text') {
        // With overridden tailChars=50, the marker should survive
        expect(part.output.value).toContain('TAIL_MARKER')
        expect(part.output.value).toContain('truncated')
      }
    }
  })

  it('last entry wins on duplicate tool name', async () => {
    const longOutput = 'x'.repeat(500)
    const prompt = makeToolPrompt(longOutput)
    const result = await truncateToolResults(prompt, {
      threshold: 50,
      headChars: 10,
      tailChars: 10,
      perTool: [{ name: 'run_cmd', threshold: 999 }, 'run_cmd']
    })

    // String 'run_cmd' wins → preserved as-is
    expect(result).toEqual(prompt)
  })

  it('routes storage-failure warnings to the injected logger', async () => {
    const logger = { warn: vi.fn() }
    const storage: VFSStorageAdapter = {
      write: () => {
        throw new Error('disk full')
      },
      read: () => null
    }
    const longOutput = 'x'.repeat(5000)
    const prompt = makeToolPrompt(longOutput)
    const result = await truncateToolResults(prompt, { threshold: 10, storage }, logger)
    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(logger.warn.mock.calls[0][0]).toContain('[context]')
    expect(logger.warn.mock.calls[0][0]).toContain('Storage adapter write failed')

    // The catch block must still fall back to simple truncation, not surface
    // the original oversized output or rethrow.
    if (result[0].role === 'tool') {
      const part = result[0].content[0]
      if (part.type === 'tool-result' && part.output.type === 'text') {
        expect(part.output.value).toContain('truncated')
        expect(part.output.value.length).toBeLessThan(longOutput.length)
      }
    }
  })

  it('filters per-part: preserves one tool while truncating another in the same message', async () => {
    const keepOutput = 'k'.repeat(500)
    const truncOutput = 't'.repeat(500)
    const prompt: LanguageModelV3Prompt = [
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call_keep',
            toolName: 'keep_me',
            output: { type: 'text', value: keepOutput }
          },
          {
            type: 'tool-result',
            toolCallId: 'call_trunc',
            toolName: 'trunc_me',
            output: { type: 'text', value: truncOutput }
          }
        ]
      }
    ]

    const result = await truncateToolResults(prompt, {
      threshold: 50,
      headChars: 5,
      tailChars: 5,
      perTool: ['keep_me']
    })

    if (result[0].role === 'tool') {
      const [keepPart, truncPart] = result[0].content
      if (keepPart.type === 'tool-result' && keepPart.output.type === 'text') {
        expect(keepPart.output.value).toBe(keepOutput)
      }
      if (truncPart.type === 'tool-result' && truncPart.output.type === 'text') {
        expect(truncPart.output.value).toContain('truncated')
        expect(truncPart.output.value.length).toBeLessThan(truncOutput.length)
      }
    }
  })
})

describe('truncateToolResults — entity codec', () => {
  const entitiesCodec: EntityToolOutputCodec = {
    deflate(value) {
      if (!Array.isArray(value)) return null
      return {
        skeleton: value,
        blobs: value.map((item, i) => ({ key: `/${i}/content`, text: (item as { content: string }).content }))
      }
    },
    assemble(skeleton, texts) {
      return (skeleton as Array<Record<string, unknown>>).map((item, i) => {
        const key = `/${i}/content`
        return key in texts && texts[key] !== item.content ? { ...item, content: texts[key] } : item
      })
    }
  }

  const BIG = 'line one of the page body\n'.repeat(30) // ~780 chars
  const entitiesPrompt = (value: unknown): LanguageModelV3Prompt => [
    {
      role: 'tool',
      content: [{ type: 'tool-result', toolCallId: 'c1', toolName: 'web_fetch', output: { type: 'json', value } }]
    }
  ]
  const options = (storage?: VFSStorageAdapter) => ({
    threshold: 100,
    headChars: 30,
    tailChars: 40,
    storage,
    perTool: [{ name: 'web_fetch', codec: entitiesCodec }]
  })
  const memoryAdapter = () => {
    const store = new Map<string, string>()
    return {
      store,
      write: (f: string, c: string) => void store.set(f, c),
      read: (f: string) => store.get(f) ?? null,
      getPhysicalPath: (f: string) => `/blobs/${f}`
    }
  }

  it('trims only the oversized entity content; identity fields survive verbatim', async () => {
    const value = [
      { id: 'cite-0', url: 'https://a.example', title: 'A', content: BIG },
      { id: 'cite-1', url: 'https://b.example', title: 'B', content: 'tiny' }
    ]
    const adapter = memoryAdapter()
    const [msg] = await truncateToolResults(entitiesPrompt(value), options(adapter))

    if (msg.role !== 'tool') throw new Error('expected tool message')
    const part = msg.content[0]
    if (part.type !== 'tool-result' || part.output.type !== 'json') throw new Error('expected json output')
    const items = part.output.value as Array<Record<string, string>>
    expect(items[0].id).toBe('cite-0')
    expect(items[0].url).toBe('https://a.example')
    expect(items[0].title).toBe('A')
    expect(items[0].content).toContain('<persisted-output>')
    expect(items[0].content.length).toBeLessThan(BIG.length)
    // Under-budget sibling entity byte-untouched (same object reference).
    expect(items[1]).toBe(value[1])
    // Full text persisted through the adapter.
    expect([...adapter.store.values()]).toContain(BIG)
  })

  it('per-entity trimmed text is byte-identical to the offloader output for the same text', async () => {
    const value = [{ id: 'cite-0', url: 'https://a.example', title: 'A', content: BIG }]
    const adapter = memoryAdapter()
    const [msg] = await truncateToolResults(entitiesPrompt(value), options(adapter))
    const expected = await new Offloader({ threshold: 100, adapter }).offloadAsync(BIG, {
      headChars: 30,
      tailChars: 40
    })

    if (msg.role !== 'tool') throw new Error('expected tool message')
    const part = msg.content[0]
    if (part.type !== 'tool-result' || part.output.type !== 'json') throw new Error('expected json output')
    expect((part.output.value as Array<{ content: string }>)[0].content).toBe(expected.content)
  })

  it('returns the part untouched (same reference) when every entity fits', async () => {
    const value = [{ id: 'cite-0', url: 'https://a.example', title: 'A', content: 'small' }]
    const prompt = entitiesPrompt(value)
    const [msg] = await truncateToolResults(prompt, options(memoryAdapter()))
    if (msg.role !== 'tool') throw new Error('expected tool message')
    expect(msg.content[0]).toBe((prompt[0] as { content: unknown[] }).content[0])
  })

  it('deflate → null (non-array error output) falls back to the opaque path', async () => {
    const errorValue = { error: 'x'.repeat(300) }
    const [msg] = await truncateToolResults(entitiesPrompt(errorValue), options(memoryAdapter()))
    if (msg.role !== 'tool') throw new Error('expected tool message')
    const part = msg.content[0]
    // Opaque path stringifies json and truncates it as text.
    if (part.type !== 'tool-result') throw new Error('expected tool-result')
    expect(part.output.type).toBe('text')
  })

  it('never re-truncates an entity whose content already carries a marker', async () => {
    const marked = `head\n<persisted-output>\nolder marker\n</persisted-output>\ntail${'x'.repeat(200)}`
    const value = [{ id: 'cite-0', content: marked }]
    const prompt = entitiesPrompt(value)
    const [msg] = await truncateToolResults(prompt, options(memoryAdapter()))
    if (msg.role !== 'tool') throw new Error('expected tool message')
    expect(msg.content[0]).toBe((prompt[0] as { content: unknown[] }).content[0])
  })

  it('a storage failure keeps that entity full while others still trim', async () => {
    const failing: VFSStorageAdapter = {
      write: () => {
        throw new Error('disk full')
      },
      read: () => null
    }
    const value = [{ id: 'cite-0', content: BIG }]
    const [msg] = await truncateToolResults(entitiesPrompt(value), options(failing))
    if (msg.role !== 'tool') throw new Error('expected tool message')
    const part = msg.content[0]
    if (part.type !== 'tool-result' || part.output.type !== 'json') throw new Error('expected json output')
    expect((part.output.value as Array<{ content: string }>)[0].content).toBe(BIG)
  })

  it('without storage falls back to inline per-entity truncation', async () => {
    const value = [{ id: 'cite-0', content: BIG }]
    const [msg] = await truncateToolResults(entitiesPrompt(value), options(undefined))
    if (msg.role !== 'tool') throw new Error('expected tool message')
    const part = msg.content[0]
    if (part.type !== 'tool-result' || part.output.type !== 'json') throw new Error('expected json output')
    const content = (part.output.value as Array<{ content: string }>)[0].content
    expect(content).toContain('--- truncated')
    expect(content.length).toBeLessThan(BIG.length)
  })
})
