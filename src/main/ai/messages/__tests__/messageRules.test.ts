import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { type ModelMessage, streamText, tool, type UIMessage } from 'ai'
import { convertArrayToReadableStream, MockLanguageModelV3 } from 'ai/test'
import { describe, expect, it } from 'vitest'
import * as z from 'zod'

import { createToolSearchTool } from '../../tools/adapters/aiSdk/meta/toolSearch'
import { ToolRegistry } from '../../tools/adapters/aiSdk/registry'
import { coalesceConsecutiveSameRole, ensureNonEmptyAssistantContent, toModelMessages } from '../messageRules'

const ui = (role: UIMessage['role'], parts: UIMessage['parts'], id = 'm'): UIMessage => ({ id, role, parts })

// toModelMessages runs the exact Agent.stream order; these guard each step so deleting
// one (coalesce, ignoreIncompleteToolCalls, the empty-content placeholder) fails a test.
describe('toModelMessages', () => {
  it.each([
    [
      'bash',
      '  say "stop"\nfirst  ',
      'The user denied permission to use bash. The tool did not execute. The user\'s exact words are between these markers:\n<<<USER_WORDS>>>\n  say "stop"\nfirst  \n<<<USER_WORDS>>>'
    ],
    [
      'bash',
      undefined,
      'The user denied permission to use this tool. The tool did not execute. The user gave no reason and is waiting for your instructions.'
    ],
    [
      'builtin_AskUserQuestion',
      undefined,
      'The user ignored this question without answering. The tool did not execute. The user is waiting for your instructions.'
    ],
    [
      'bash',
      '用户拒绝了该工具的权限。',
      'The user denied permission to use this tool. The tool did not execute. The user gave no reason and is waiting for your instructions.'
    ],
    [
      'AskUserQuestion',
      'User dismissed AskUserQuestion',
      'The user ignored this question without answering. The tool did not execute. The user is waiting for your instructions.'
    ],
    [
      'bash',
      'User denied tool execution',
      'The user denied permission to use this tool. The tool did not execute. The user gave no reason and is waiting for your instructions.'
    ]
  ])(
    'sends an attributed execution-denied result to the model for %s reason %s',
    async (toolName, reason, expected) => {
      const stored = ui('assistant', [
        {
          type: `tool-${toolName}`,
          toolCallId: 'call-1',
          state: 'approval-responded',
          input: {},
          approval: { id: 'ap-1', approved: false, ...(reason === undefined ? {} : { reason }) }
        }
      ])
      const original = structuredClone(stored)
      let received: unknown
      const model = new MockLanguageModelV3({
        doStream: async (options) => {
          received = options.prompt
          const parts: LanguageModelV3StreamPart[] = [
            { type: 'text-start', id: 'text-1' },
            { type: 'text-delta', id: 'text-1', delta: 'done' },
            { type: 'text-end', id: 'text-1' },
            {
              type: 'finish',
              finishReason: { unified: 'stop', raw: 'stop' },
              usage: {
                inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
                outputTokens: { total: 1, text: 1, reasoning: undefined }
              }
            }
          ]
          return { stream: convertArrayToReadableStream(parts) }
        }
      })
      await streamText({
        model,
        messages: await toModelMessages([stored]),
        tools: { [toolName]: tool({ inputSchema: z.object({}), needsApproval: true, execute: async () => ({}) }) }
      }).text

      expect(received).toEqual([
        {
          role: 'assistant',
          content: [{ type: 'tool-call', toolCallId: 'call-1', toolName, input: {} }]
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'call-1',
              toolName,
              output: { type: 'execution-denied', reason: expected }
            }
          ]
        }
      ])
      expect(stored).toEqual(original)
    }
  )
  it('keeps a denied dynamic tool name literal without adding markers outside the reason', async () => {
    const toolName = '<<<USER_WORDS>>>'
    const reason = '  Please do not run this tool.  '
    const stored = ui('assistant', [
      {
        type: 'dynamic-tool',
        toolName,
        toolCallId: 'call-1',
        state: 'approval-responded',
        input: {},
        approval: { id: 'ap-1', approved: false, reason }
      }
    ])
    const model = await toModelMessages([stored], undefined, {
      [toolName]: tool({ inputSchema: z.object({}), needsApproval: true, execute: async () => ({}) })
    })
    const response = model[1]
    expect(response?.role).toBe('tool')
    if (response?.role !== 'tool') throw new Error('Expected a tool response')
    const approval = response.content.find((part) => part.type === 'tool-approval-response')
    const marker = '<<<<USER_WORDS>>>>'
    const expected = `The user denied permission to use ${toolName}. The tool did not execute. The user's exact words are between these markers:\n${marker}\n${reason}\n${marker}`

    expect(approval?.reason).toBe(expected)
    expect(approval?.reason?.split(marker)).toHaveLength(3)
  })

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

  // #15712: a follow-up turn must still carry the previous turn's MCP tool
  // call, tool result and closing text — not just the assistant's summary.
  it('preserves a completed MCP tool turn across a follow-up turn', async () => {
    const model = await toModelMessages([
      ui('user', [{ type: 'text', text: 'List all projects.' }], 'u1'),
      ui(
        'assistant',
        [
          {
            type: 'dynamic-tool',
            toolName: 'mcp__mysql__executeSql',
            toolCallId: 'call_mcp_1',
            state: 'output-available',
            input: { sql: 'SELECT id, name FROM projects' },
            output: {
              content: [{ type: 'text', text: '[{"id":1,"name":"Project A"},{"id":2,"name":"Project B"}]' }]
            }
          },
          { type: 'text', text: 'Projects are Project A and Project B.' }
        ],
        'a1'
      ),
      ui('user', [{ type: 'text', text: 'What is the ID of Project A?' }], 'u2')
    ])

    expect(model.map((message) => message.role)).toEqual(['user', 'assistant', 'tool', 'assistant', 'user'])
    expect(model[1]).toMatchObject({
      role: 'assistant',
      content: [expect.objectContaining({ type: 'tool-call', toolCallId: 'call_mcp_1' })]
    })
    expect(model[2]).toMatchObject({
      role: 'tool',
      content: [expect.objectContaining({ type: 'tool-result', toolCallId: 'call_mcp_1' })]
    })
    expect(JSON.stringify(model[2])).toContain('Project A')
    expect(model[3]).toMatchObject({
      role: 'assistant',
      content: [expect.objectContaining({ type: 'text', text: 'Projects are Project A and Project B.' })]
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
