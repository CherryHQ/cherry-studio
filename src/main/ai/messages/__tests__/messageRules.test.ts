import { type ModelMessage, tool, type UIMessage } from 'ai'
import { describe, expect, it } from 'vitest'
import * as z from 'zod'

import { coalesceConsecutiveSameRole, ensureNonEmptyAssistantContent, toModelMessages } from '../messageRules'

const ui = (role: UIMessage['role'], parts: UIMessage['parts'], id = 'm'): UIMessage => ({ id, role, parts })

// toModelMessages runs the exact Agent.stream order; these guard each step so deleting
// one (coalesce, ignoreIncompleteToolCalls, the empty-content placeholder) fails a test.
describe('toModelMessages', () => {
  it('keeps knowledge scope out of provider messages', async () => {
    const model = await toModelMessages([
      ui('user', [
        { type: 'text', text: 'search this' },
        { type: 'data-knowledge-scope', data: { baseIds: ['kb-1'] } }
      ])
    ])

    expect(model).toEqual([{ role: 'user', content: [{ type: 'text', text: 'search this' }] }])
  })

  it('rescues a data-error-only assistant turn (#16195)', async () => {
    const model = await toModelMessages([
      ui('user', [{ type: 'text', text: 'Q' }], 'u1'),
      ui('assistant', [{ type: 'data-error', data: {} }], 'a1'),
      ui('user', [{ type: 'text', text: '继续' }], 'u2')
    ])
    expect(model).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'Q' }] },
      { role: 'assistant', content: [{ type: 'text', text: '...' }] },
      { role: 'user', content: [{ type: 'text', text: '继续' }] }
    ])
  })

  it('drops an empty-parts assistant turn and coalesces the surrounding user turns', async () => {
    const model = await toModelMessages([
      ui('user', [{ type: 'text', text: 'Q' }], 'u1'),
      ui('assistant', [], 'a1'),
      ui('user', [{ type: 'text', text: '继续' }], 'u2')
    ])
    expect(model).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Q' },
          { type: 'text', text: '继续' }
        ]
      }
    ])
  })

  it('drops an incomplete tool call (ignoreIncompleteToolCalls)', async () => {
    const model = await toModelMessages([
      ui('user', [{ type: 'text', text: 'Q' }], 'u1'),
      ui('assistant', [{ type: 'tool-test', toolCallId: '1', state: 'input-available', input: {} }], 'a1'),
      ui('user', [{ type: 'text', text: '继续' }], 'u2')
    ])
    expect(model).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Q' },
          { type: 'text', text: '继续' }
        ]
      }
    ])
  })

  it('strips gated media the model cannot accept', async () => {
    const model = await toModelMessages(
      [ui('user', [{ type: 'file', mediaType: 'video/mp4', url: 'data:application/octet-stream;base64,AA' }])],
      { image: true, video: false, audio: true }
    )
    expect(model).toEqual([
      { role: 'user', content: [{ type: 'text', text: expect.stringContaining('video attachment omitted') }] }
    ])
  })

  it('uses the tool model-output formatter when replaying completed tool results', async () => {
    const imageData = 'A'.repeat(1024)
    const rawOutput = {
      content: [{ type: 'image', data: imageData, mimeType: 'image/png' }]
    }
    const messages = [
      ui('assistant', [
        {
          type: 'tool-screenshot',
          toolCallId: 'call-1',
          state: 'output-available',
          input: {},
          output: rawOutput
        }
      ]),
      ui('user', [{ type: 'text', text: 'continue' }], 'u1')
    ]
    const originalMessages = structuredClone(messages)
    const tools = {
      screenshot: tool({
        inputSchema: z.object({}),
        toModelOutput: () => ({ type: 'text', value: '[Image: image/png, delivered to user]' })
      })
    }

    const model = await toModelMessages(messages, undefined, tools)

    expect(model[1]).toEqual({
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'call-1',
          toolName: 'screenshot',
          output: { type: 'text', value: '[Image: image/png, delivered to user]' }
        }
      ]
    })
    expect(JSON.stringify(model)).not.toContain(imageData)
    expect(messages).toEqual(originalMessages)
  })

  it('replays a completed legacy MCP tool name unchanged', async () => {
    const legacyToolName = 'mcp__mysql__executeSql'
    const model = await toModelMessages([
      ui('assistant', [
        {
          type: 'dynamic-tool',
          toolName: legacyToolName,
          toolCallId: 'legacy-call',
          state: 'output-available',
          input: { sql: 'select 1' },
          output: { ok: true }
        }
      ])
    ])

    expect(model[0]).toMatchObject({
      role: 'assistant',
      content: [expect.objectContaining({ type: 'tool-call', toolName: legacyToolName })]
    })
    expect(model[1]).toMatchObject({
      role: 'tool',
      content: [expect.objectContaining({ type: 'tool-result', toolName: legacyToolName })]
    })
  })

  it('rewrites a v1 "server: tool" name to a wire-legal one on both call and result (#18199)', async () => {
    const model = await toModelMessages([
      ui('assistant', [
        {
          type: 'dynamic-tool',
          toolName: 'jina: jina_reader',
          toolCallId: 'call_00_1',
          state: 'output-available',
          input: { url: 'https://example.com' },
          output: { ok: true }
        }
      ])
    ])

    expect(model[0]).toMatchObject({
      role: 'assistant',
      content: [expect.objectContaining({ type: 'tool-call', toolName: 'jina__jina_reader' })]
    })
    expect(model[1]).toMatchObject({
      role: 'tool',
      content: [expect.objectContaining({ type: 'tool-result', toolName: 'jina__jina_reader' })]
    })
  })

  it('caps a v1 name at the 64-char / leading-letter provider limits', async () => {
    const model = await toModelMessages([
      ui('assistant', [
        {
          type: 'dynamic-tool',
          toolName: `1${'长'.repeat(80)}: search`,
          toolCallId: 'call_00_2',
          state: 'output-available',
          input: {},
          output: { ok: true }
        }
      ])
    ])

    const toolName = (model[0].content as { toolName: string }[])[0].toolName
    expect(toolName).toMatch(/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/)
  })
})

describe('ensureNonEmptyAssistantContent', () => {
  it('replaces an assistant message with empty content with a placeholder', () => {
    expect(ensureNonEmptyAssistantContent([{ role: 'assistant', content: [] }])).toEqual([
      { role: 'assistant', content: [{ type: 'text', text: '...' }] }
    ])
  })

  it('leaves non-empty and non-assistant messages untouched (same reference)', () => {
    const msgs = [
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }
    ] as ModelMessage[]
    const out = ensureNonEmptyAssistantContent(msgs)
    expect(out[0]).toBe(msgs[0])
    expect(out[1]).toBe(msgs[1])
  })
})

describe('coalesceConsecutiveSameRole', () => {
  it('merges adjacent same-role messages by concatenating content', () => {
    const out = coalesceConsecutiveSameRole([
      { role: 'user', content: [{ type: 'text', text: 'a' }] },
      { role: 'user', content: [{ type: 'text', text: 'b' }] }
    ] as ModelMessage[])
    expect(out).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'a' },
          { type: 'text', text: 'b' }
        ]
      }
    ])
  })

  it('does not merge across an intervening tool message', () => {
    const msgs = [
      { role: 'assistant', content: [{ type: 'text', text: 'x' }] },
      {
        role: 'tool',
        content: [{ type: 'tool-result', toolCallId: '1', toolName: 't', output: { type: 'json', value: {} } }]
      },
      { role: 'assistant', content: [{ type: 'text', text: 'y' }] }
    ] as ModelMessage[]
    expect(coalesceConsecutiveSameRole(msgs)).toHaveLength(3)
  })

  it('joins string content (e.g. consecutive system messages)', () => {
    const out = coalesceConsecutiveSameRole([
      { role: 'system', content: 'a' },
      { role: 'system', content: 'b' }
    ] as ModelMessage[])
    expect(out).toEqual([{ role: 'system', content: 'a\n\nb' }])
  })
})
