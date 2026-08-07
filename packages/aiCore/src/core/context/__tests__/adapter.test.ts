import type { LanguageModelV3Prompt } from '@ai-sdk/provider'
import { describe, expect, it } from 'vitest'

import { fromAISDK, toAISDK } from '../adapter'
import type { ContextMessage } from '../types'

describe('fromAISDK', () => {
  it('converts system messages', () => {
    const prompt: LanguageModelV3Prompt = [{ role: 'system', content: 'You are helpful.' }]
    const result = fromAISDK(prompt)
    expect(result).toEqual([{ role: 'system', content: 'You are helpful.' }])
  })

  it('converts user messages with text parts', () => {
    const prompt: LanguageModelV3Prompt = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Hello' },
          { type: 'text', text: 'World' }
        ]
      }
    ]
    const result = fromAISDK(prompt)
    expect(result[0].content).toBe('Hello\nWorld')
    expect(result[0]._userContent).toBeDefined()
  })

  it('stores original content including file parts', () => {
    const filePart = {
      type: 'file' as const,
      data: 'base64data',
      mediaType: 'image/png'
    }
    const content = [{ type: 'text' as const, text: 'Look at this' }, filePart]
    const prompt: LanguageModelV3Prompt = [{ role: 'user', content }]
    const result = fromAISDK(prompt)
    expect(result[0].content).toBe('Look at this')
    expect(result[0]._userContent).toEqual(content)
    expect(result[0].attachments).toEqual([{ mediaType: 'image/png', data: 'base64data' }])
  })

  it('maps multiple file parts to attachments', () => {
    const prompt: LanguageModelV3Prompt = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Check these' },
          { type: 'file', data: 'img1', mediaType: 'image/png' },
          { type: 'file', data: 'doc1', mediaType: 'application/pdf', filename: 'report.pdf' }
        ]
      }
    ]
    const result = fromAISDK(prompt)
    expect(result[0].attachments).toEqual([
      { mediaType: 'image/png', data: 'img1' },
      { mediaType: 'application/pdf', data: 'doc1', filename: 'report.pdf' }
    ])
  })

  it('does not set attachments when no file parts exist', () => {
    const prompt: LanguageModelV3Prompt = [{ role: 'user', content: [{ type: 'text', text: 'Just text' }] }]
    const result = fromAISDK(prompt)
    expect(result[0].attachments).toBeUndefined()
  })

  it('preserves Uint8Array file data verbatim through _userContent (no encoding into Attachment.data)', () => {
    const bytes = new Uint8Array([72, 101, 108, 108, 111]) // "Hello"
    const prompt: LanguageModelV3Prompt = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Binary please' },
          { type: 'file', data: bytes, mediaType: 'image/png' }
        ]
      }
    ]
    const result = fromAISDK(prompt)
    // Attachment.data is empty here — it's only a presence signal for Janitor.
    // The real binary lives on _userContent for the AI SDK round-trip.
    expect(result[0].attachments).toEqual([{ mediaType: 'image/png', data: '' }])
    const filePart = result[0]._userContent?.find((p) => p.type === 'file')
    expect(filePart && filePart.type === 'file' ? filePart.data : undefined).toBe(bytes) // same reference, not a copy
  })

  it('preserves URL file data verbatim through _userContent (no toString into Attachment.data)', () => {
    const url = new URL('https://example.com/img.png')
    const prompt: LanguageModelV3Prompt = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Remote image' },
          { type: 'file', data: url, mediaType: 'image/png' }
        ]
      }
    ]
    const result = fromAISDK(prompt)
    expect(result[0].attachments).toEqual([{ mediaType: 'image/png', data: '' }])
    const filePart = result[0]._userContent?.find((p) => p.type === 'file')
    expect(filePart && filePart.type === 'file' ? filePart.data : undefined).toBe(url) // same URL instance, not toString'd
  })

  it('toAISDK round-trips Uint8Array binary back to the AI SDK provider verbatim', () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5])
    const prompt: LanguageModelV3Prompt = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'binary' },
          { type: 'file', data: bytes, mediaType: 'image/png' }
        ]
      }
    ]
    const ir = fromAISDK(prompt)
    const roundTripped = toAISDK(ir)
    const userMsg = roundTripped.find((m) => m.role === 'user')
    const content = userMsg?.content as Array<{ type: string; data?: unknown }>
    expect(Array.isArray(content)).toBe(true)
    const filePart = content.find((p) => p.type === 'file')
    expect(filePart?.data).toBe(bytes) // same reference
  })

  it('converts assistant messages with text + tool calls', () => {
    const prompt: LanguageModelV3Prompt = [
      { role: 'user', content: [{ type: 'text', text: 'weather?' }] },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me check.' },
          {
            type: 'tool-call',
            toolCallId: 'call_1',
            toolName: 'get_weather',
            input: { city: 'Tokyo' }
          }
        ]
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call_1',
            toolName: 'get_weather',
            output: { type: 'text', value: 'Sunny' }
          }
        ]
      }
    ]
    const result = fromAISDK(prompt)
    expect(result[1].content).toBe('Let me check.')
    expect(result[1].tool_calls).toEqual([
      {
        id: 'call_1',
        type: 'function',
        function: { name: 'get_weather', arguments: '{"city":"Tokyo"}' }
      }
    ])
    expect(result[1]._assistantContent).toBeDefined()
  })

  it('converts assistant reasoning to thinking', () => {
    const prompt: LanguageModelV3Prompt = [
      { role: 'user', content: [{ type: 'text', text: 'reason about this' }] },
      {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'I need to think...' },
          { type: 'text', text: 'Here is my answer.' }
        ]
      }
    ]
    const result = fromAISDK(prompt)
    expect(result[1].thinking).toEqual({ thinking: 'I need to think...' })
    expect(result[1].content).toBe('Here is my answer.')
  })

  it('maps assistant file parts to attachments', () => {
    const prompt: LanguageModelV3Prompt = [
      { role: 'user', content: [{ type: 'text', text: 'generate an image' }] },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Here is the image.' },
          { type: 'file', data: 'generated_img', mediaType: 'image/png' }
        ]
      }
    ]
    const result = fromAISDK(prompt)
    expect(result[1].content).toBe('Here is the image.')
    expect(result[1].attachments).toEqual([{ mediaType: 'image/png', data: 'generated_img' }])
  })

  it('converts tool messages to individual IR messages', () => {
    const prompt: LanguageModelV3Prompt = [
      { role: 'user', content: [{ type: 'text', text: 'q' }] },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call_1',
            toolName: 'get_weather',
            input: {}
          },
          {
            type: 'tool-call',
            toolCallId: 'call_2',
            toolName: 'get_time',
            input: {}
          }
        ]
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call_1',
            toolName: 'get_weather',
            output: { type: 'text', value: 'Sunny, 25°C' }
          },
          {
            type: 'tool-result',
            toolCallId: 'call_2',
            toolName: 'get_time',
            output: { type: 'text', value: '14:30' }
          }
        ]
      }
    ]
    const result = fromAISDK(prompt)
    const toolMessages = result.filter((m) => m.role === 'tool')
    expect(toolMessages).toHaveLength(2)
    expect(toolMessages[0]).toMatchObject({
      role: 'tool',
      content: 'Sunny, 25°C',
      tool_call_id: 'call_1'
    })
    expect(toolMessages[0]._toolContent).toBeDefined()
    expect(toolMessages[1]).toMatchObject({
      role: 'tool',
      content: '14:30',
      tool_call_id: 'call_2'
    })
  })

  it('handles json tool result output', () => {
    const prompt: LanguageModelV3Prompt = [
      { role: 'user', content: [{ type: 'text', text: 'query' }] },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call_1',
            toolName: 'query_db',
            input: {}
          }
        ]
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call_1',
            toolName: 'query_db',
            output: { type: 'json', value: { rows: 42 } }
          }
        ]
      }
    ]
    const result = fromAISDK(prompt)
    const toolMsg = result.find((m) => m.role === 'tool')
    expect(toolMsg?.content).toBe('{"rows":42}')
  })

  // ─── Boundary sanitization ───
  it('injects placeholder for missing tool result at boundary', () => {
    const prompt: LanguageModelV3Prompt = [
      { role: 'user', content: [{ type: 'text', text: 'do it' }] },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call_1',
            toolName: 'run',
            input: {}
          }
        ]
      },
      // Missing: tool message for call_1
      { role: 'user', content: [{ type: 'text', text: 'what happened?' }] }
    ]
    const result = fromAISDK(prompt)

    const placeholder = result.find((m) => m.role === 'tool' && m.tool_call_id === 'call_1')
    expect(placeholder?.content).toBe('[No tool result available]')
    // Placeholder must carry the original tool name on IR `name` so toAISDK
    // can emit a real toolName instead of 'unknown' (strict providers reject 'unknown').
    expect(placeholder?.name).toBe('run')
  })

  // ─── FIX #3: tool-call with input:undefined yields a string '{}' ───
  it('serializes a tool-call with undefined input to "{}" (a string)', () => {
    const prompt: LanguageModelV3Prompt = [
      { role: 'user', content: [{ type: 'text', text: 'go' }] },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call_1',
            toolName: 'run',
            // deliberately exercising the undefined-input edge
            input: undefined as unknown
          }
        ]
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call_1',
            toolName: 'run',
            output: { type: 'text', value: 'done' }
          }
        ]
      }
    ]
    const result = fromAISDK(prompt)
    const args = result[1].tool_calls?.[0].function.arguments
    expect(args).toBe('{}')
    expect(typeof args).toBe('string')
  })

  it('round-trips sanitized placeholder with original toolName (not "unknown")', () => {
    // Regression guard for the boundary-sanitize bug where injected placeholders
    // round-tripped as `toolName: 'unknown'` because toAISDK only read _toolName.
    const prompt: LanguageModelV3Prompt = [
      { role: 'user', content: [{ type: 'text', text: 'do it' }] },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call_1',
            toolName: 'run',
            input: {}
          }
        ]
      },
      // Missing: tool message — sanitization will inject one
      { role: 'user', content: [{ type: 'text', text: 'next' }] }
    ]
    const ir = fromAISDK(prompt)
    const roundTripped = toAISDK(ir)

    const toolMessage = roundTripped.find((m) => m.role === 'tool')
    expect(toolMessage).toBeDefined()
    if (toolMessage?.role !== 'tool') throw new Error('expected tool role')
    const toolPart = toolMessage.content[0]
    expect(toolPart.type).toBe('tool-result')
    if (toolPart.type !== 'tool-result') throw new Error('expected tool-result part')
    expect(toolPart.toolCallId).toBe('call_1')
    // Critical: toolName must match the originating assistant's tool call,
    // not the literal string 'unknown'.
    expect(toolPart.toolName).toBe('run')
  })
})

describe('toAISDK', () => {
  it('converts system messages', () => {
    const messages: ContextMessage[] = [{ role: 'system', content: 'Be helpful.' }]
    const result = toAISDK(messages)
    expect(result).toEqual([{ role: 'system', content: 'Be helpful.' }])
  })

  it('falls back to text part when no original content (e.g. compression summary)', () => {
    const messages: ContextMessage[] = [{ role: 'user', content: 'Hi there' }]
    const result = toAISDK(messages)
    expect(result).toEqual([{ role: 'user', content: [{ type: 'text', text: 'Hi there' }] }])
  })

  it('uses original content for lossless round-trip', () => {
    const originalContent = [
      { type: 'text' as const, text: 'See this' },
      { type: 'file' as const, data: 'base64data', mediaType: 'image/png' }
    ]
    const messages: ContextMessage[] = [
      {
        role: 'user',
        content: 'See this',
        _userContent: originalContent,
        _originalText: 'See this'
      }
    ]
    const result = toAISDK(messages)
    expect(result[0]).toMatchObject({ role: 'user', content: originalContent })
  })

  it('coalesces consecutive tool messages', () => {
    const part1 = {
      type: 'tool-result' as const,
      toolCallId: 'call_1',
      toolName: 'tool_a',
      output: { type: 'text' as const, value: 'result1' }
    }
    const part2 = {
      type: 'tool-result' as const,
      toolCallId: 'call_2',
      toolName: 'tool_b',
      output: { type: 'text' as const, value: 'result2' }
    }
    const messages: ContextMessage[] = [
      {
        role: 'tool',
        content: 'result1',
        tool_call_id: 'call_1',
        _toolContent: [part1],
        _originalText: 'result1'
      },
      {
        role: 'tool',
        content: 'result2',
        tool_call_id: 'call_2',
        _toolContent: [part2],
        _originalText: 'result2'
      }
    ]
    const result = toAISDK(messages)
    expect(result).toHaveLength(1)
    expect(result[0].role).toBe('tool')
    if (result[0].role === 'tool') {
      expect(result[0].content).toHaveLength(2)
      const p0 = result[0].content[0]
      const p1 = result[0].content[1]
      if (p0.type === 'tool-result' && p1.type === 'tool-result') {
        expect(p0.toolCallId).toBe('call_1')
        expect(p1.toolCallId).toBe('call_2')
      }
    }
  })

  it('falls back for tool messages without original content', () => {
    const messages: ContextMessage[] = [{ role: 'tool', content: 'some output', tool_call_id: 'call_1' }]
    const result = toAISDK(messages)
    if (result[0].role === 'tool') {
      const part = result[0].content[0]
      if (part.type === 'tool-result') {
        expect(part.output).toEqual({
          type: 'text',
          value: 'some output'
        })
      }
    }
  })
})

describe('round-trip', () => {
  it('preserves a full conversation through fromAISDK → toAISDK', () => {
    const original: LanguageModelV3Prompt = [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: [{ type: 'text', text: 'What is 2+2?' }] },
      { role: 'assistant', content: [{ type: 'text', text: '4' }] },
      { role: 'user', content: [{ type: 'text', text: 'Thanks!' }] }
    ]

    const ir = fromAISDK(original)
    const roundTripped = toAISDK(ir)
    expect(roundTripped).toEqual(original)
  })

  it('preserves tool call + result through round-trip', () => {
    const original: LanguageModelV3Prompt = [
      { role: 'user', content: [{ type: 'text', text: 'find something' }] },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me search.' },
          {
            type: 'tool-call',
            toolCallId: 'call_1',
            toolName: 'search',
            input: { query: 'test' }
          }
        ]
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call_1',
            toolName: 'search',
            output: { type: 'text', value: 'Found 5 results' }
          }
        ]
      }
    ]

    const ir = fromAISDK(original)
    const roundTripped = toAISDK(ir)
    expect(roundTripped).toEqual(original)
  })

  it('preserves file parts through round-trip', () => {
    const original: LanguageModelV3Prompt = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Analyze this' },
          { type: 'file', data: 'base64data', mediaType: 'image/png' }
        ]
      }
    ]

    const ir = fromAISDK(original)
    const roundTripped = toAISDK(ir)
    expect(roundTripped).toEqual(original)
  })

  it('uses modified content when Janitor changes it (e.g. compact)', () => {
    const original: LanguageModelV3Prompt = [
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call_1',
            toolName: 'run_cmd',
            output: { type: 'text', value: 'very long output here' }
          }
        ]
      }
    ]

    const ir = fromAISDK(original)
    // Simulate what Janitor.compact() does: replace content
    ir[0].content = '[Old tool result content cleared]'

    const roundTripped = toAISDK(ir)
    if (roundTripped[0].role === 'tool') {
      const part = roundTripped[0].content[0]
      if (part.type === 'tool-result') {
        expect(part.output).toEqual({ type: 'text', value: '[Old tool result content cleared]' })
        expect(part.toolName).toBe('run_cmd')
      }
    }
  })

  it('preserves providerOptions through round-trip', () => {
    const original: LanguageModelV3Prompt = [
      {
        role: 'user',
        content: [{ type: 'text', text: 'Hello' }],
        providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } }
      }
    ]

    const ir = fromAISDK(original)
    const roundTripped = toAISDK(ir)
    expect(roundTripped).toEqual(original)
  })

  // ─── FIX #1: inline (provider-executed) tool-result must not trigger a placeholder ───
  it('does not inject a placeholder for an inline (provider-executed) tool-result', () => {
    const original: LanguageModelV3Prompt = [
      { role: 'user', content: [{ type: 'text', text: 'search the web' }] },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Searching.' },
          {
            type: 'tool-call',
            toolCallId: 'c1',
            toolName: 'web_search',
            input: { q: 'context-chef' }
          },
          {
            type: 'tool-result',
            toolCallId: 'c1',
            toolName: 'web_search',
            output: { type: 'text', value: 'inline result' }
          }
        ]
      }
    ]

    const ir = fromAISDK(original)
    // The self-answered call must not appear as an open call in IR.
    const assistant = ir.find((m) => m.role === 'assistant')
    expect(assistant?.tool_calls).toBeUndefined()
    // No placeholder tool message injected by ensureValidHistory.
    expect(ir.some((m) => m.role === 'tool')).toBe(false)

    const roundTripped = toAISDK(ir)
    expect(roundTripped).toEqual(original)
  })

  it('pairs a normal tool-call and skips an inline one in the same assistant message', () => {
    const original: LanguageModelV3Prompt = [
      { role: 'user', content: [{ type: 'text', text: 'do two things' }] },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Working.' },
          { type: 'tool-call', toolCallId: 'c1', toolName: 'get_weather', input: { city: 'NY' } },
          { type: 'tool-call', toolCallId: 'c2', toolName: 'web_search', input: { q: 'x' } },
          {
            type: 'tool-result',
            toolCallId: 'c2',
            toolName: 'web_search',
            output: { type: 'text', value: 'inline answer' }
          }
        ]
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'c1',
            toolName: 'get_weather',
            output: { type: 'text', value: 'Sunny' }
          }
        ]
      }
    ]

    const ir = fromAISDK(original)
    // Only the genuinely-open call (c1) is projected to IR tool_calls.
    const assistant = ir.find((m) => m.role === 'assistant')
    expect(assistant?.tool_calls).toEqual([
      { id: 'c1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"NY"}' } }
    ])
    // The separate tool message pairs c1; no placeholder for c2.
    const toolMessages = ir.filter((m) => m.role === 'tool')
    expect(toolMessages).toHaveLength(1)
    expect(toolMessages[0].tool_call_id).toBe('c1')
    expect(ir.some((m) => m.content === '[No tool result available]')).toBe(false)

    const roundTripped = toAISDK(ir)
    expect(roundTripped).toEqual(original)
  })

  // ─── FIX #2: tool-message-level providerOptions survives round-trip ───
  it('preserves tool-message-level providerOptions through round-trip', () => {
    const original: LanguageModelV3Prompt = [
      { role: 'user', content: [{ type: 'text', text: 'run it' }] },
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'run', input: {} }]
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'c1',
            toolName: 'run',
            output: { type: 'text', value: 'ok' }
          }
        ],
        providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } }
      }
    ]

    const ir = fromAISDK(original)
    const roundTripped = toAISDK(ir)
    expect(roundTripped).toEqual(original)
  })
})
