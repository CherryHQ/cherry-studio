import type { LanguageModelV3Prompt } from '@ai-sdk/provider'
import { describe, expect, it, vi } from 'vitest'

import type { VFSStorageAdapter } from '../offloader'
import { truncateToolResults } from '../truncator'

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
