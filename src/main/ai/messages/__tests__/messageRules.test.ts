import { type ModelMessage, tool, type UIMessage } from 'ai'
import { describe, expect, it } from 'vitest'
import * as z from 'zod'

import { createToolSearchTool } from '../../tools/adapters/aiSdk/meta/toolSearch'
import { ToolRegistry } from '../../tools/adapters/aiSdk/registry'
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

  it('drops a tool call parked on an unanswered approval (#17936)', async () => {
    const model = await toModelMessages([
      ui('user', [{ type: 'text', text: 'Q' }], 'u1'),
      ui(
        'assistant',
        [
          { type: 'text', text: 'let me check' },
          {
            type: 'tool-kb_manage',
            toolCallId: '1',
            state: 'approval-requested',
            input: {},
            approval: { id: 'ap-1' }
          }
        ],
        'a1'
      ),
      ui('user', [{ type: 'text', text: '继续' }], 'u2')
    ])
    expect(model).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'Q' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'let me check' }] },
      { role: 'user', content: [{ type: 'text', text: '继续' }] }
    ])
  })

  it('keeps an answered approval so the continuation can resume it', async () => {
    const model = await toModelMessages([
      ui('user', [{ type: 'text', text: 'Q' }], 'u1'),
      ui(
        'assistant',
        [
          {
            type: 'tool-kb_manage',
            toolCallId: '1',
            state: 'approval-responded',
            input: {},
            approval: { id: 'ap-1', approved: true }
          }
        ],
        'a1'
      )
    ])
    expect(model[1]).toEqual({
      role: 'assistant',
      content: [
        { type: 'tool-call', toolCallId: '1', toolName: 'kb_manage', input: {}, providerExecuted: undefined },
        { type: 'tool-approval-request', approvalId: 'ap-1', toolCallId: '1' }
      ]
    })
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

  it('replays a malformed stored tool_search result without making the topic unsendable', async () => {
    const toolSearch = createToolSearchTool(new ToolRegistry(), new Set(), new Set())
    const model = await toModelMessages(
      [
        ui('assistant', [
          {
            type: 'tool-tool_search',
            toolCallId: 'search-1',
            state: 'output-available',
            input: {},
            output: { content: [{ type: 'text', text: 'Process started' }], metadata: {} }
          }
        ]),
        ui('user', [{ type: 'text', text: 'continue' }], 'u1')
      ],
      undefined,
      { tool_search: toolSearch }
    )

    expect(model[1]).toMatchObject({
      role: 'tool',
      content: [
        expect.objectContaining({
          toolName: 'tool_search',
          output: {
            type: 'text',
            value: 'The stored tool search result could not be read. Ignore it and run `tool_search` again.'
          }
        })
      ]
    })
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

  const legacyTool = (toolName: string, toolCallId: string): UIMessage['parts'][number] => ({
    type: 'dynamic-tool',
    toolName,
    toolCallId,
    state: 'output-available',
    input: {},
    output: { ok: true }
  })

  const namesOf = (message: ModelMessage) => (message.content as { toolName: string }[]).map((p) => p.toolName)

  it('rewrites a v1 "server: tool" name to a wire-legal one on both call and result (#18199)', async () => {
    const model = await toModelMessages([ui('assistant', [legacyTool('jina: jina_reader', 'call_00_1')])])

    const wireName = namesOf(model[0])[0]
    expect(wireName).toMatch(/^jina__jina_reader_[0-9a-f]{8}$/)
    expect(model[1]).toMatchObject({
      role: 'tool',
      content: [expect.objectContaining({ type: 'tool-result', toolName: wireName })]
    })
  })

  it('keeps distinct v1 names distinct past the 64-char / leading-letter provider limits', async () => {
    const server = `1${'长'.repeat(80)}`
    const model = await toModelMessages([
      ui('assistant', [legacyTool(`${server}: search`, 'call_00_2'), legacyTool(`${server}: fetch`, 'call_00_3')])
    ])

    const [search, fetch] = namesOf(model[0])
    expect(search).toMatch(/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/)
    expect(fetch).toMatch(/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/)
    expect(search).not.toBe(fetch)
  })

  // The API Gateway shares this path and keys its ToolSet by the client's own function name.
  it('leaves a declared tool name untouched even when it holds provider-specific characters', async () => {
    const declared = 'maps.lookup'
    const model = await toModelMessages([ui('assistant', [legacyTool(declared, 'call_00_4')])], undefined, {
      [declared]: tool({ inputSchema: z.object({}), toModelOutput: () => ({ type: 'text', value: 'formatted' }) })
    })

    expect(namesOf(model[0])).toEqual([declared])
    expect(model[1]).toMatchObject({
      role: 'tool',
      content: [expect.objectContaining({ toolName: declared, output: { type: 'text', value: 'formatted' } })]
    })
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
