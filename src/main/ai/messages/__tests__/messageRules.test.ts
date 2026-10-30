import { type ModelMessage, tool, type UIMessage } from 'ai'
import { describe, expect, it } from 'vitest'
import * as z from 'zod'

import { mcpResultToModelOutput } from '@main/ai/tools/adapters/aiSdk/mcp/utils'

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

  it('attributes a denied approval reason to the user, leaving the stored part alone', async () => {
    const messages = [
      ui('user', [{ type: 'text', text: 'Q' }], 'u1'),
      ui(
        'assistant',
        [
          {
            type: 'tool-kb_manage',
            toolCallId: '1',
            state: 'approval-responded',
            input: {},
            approval: { id: 'ap-1', approved: false, reason: 'use a copy' }
          }
        ],
        'a1'
      )
    ]

    const model = await toModelMessages(messages)

    expect(model[2]).toMatchObject({
      role: 'tool',
      content: [
        {
          type: 'tool-approval-response',
          approvalId: 'ap-1',
          approved: false,
          reason:
            "The user doesn't want to proceed with this tool use. The tool use was rejected (it did not run). To tell you how to proceed, the user said:\nuse a copy"
        }
      ]
    })
    expect((messages[1].parts[0] as { approval?: { reason?: string } }).approval?.reason).toBe('use a copy')
  })

  it('attributes a denied approval reason on the terminal output-denied shape', async () => {
    const model = await toModelMessages([
      ui('user', [{ type: 'text', text: 'Q' }], 'u1'),
      ui(
        'assistant',
        [
          {
            type: 'tool-kb_manage',
            toolCallId: '1',
            state: 'output-denied',
            input: {},
            approval: { id: 'ap-1', approved: false, reason: 'use a copy' }
          }
        ],
        'a1'
      )
    ])

    expect(model[2]).toMatchObject({
      role: 'tool',
      content: [
        {
          type: 'tool-approval-response',
          approvalId: 'ap-1',
          approved: false,
          reason:
            "The user doesn't want to proceed with this tool use. The tool use was rejected (it did not run). To tell you how to proceed, the user said:\nuse a copy"
        },
        {
          type: 'tool-result',
          toolCallId: '1',
          toolName: 'kb_manage',
          output: {
            type: 'error-text',
            value:
              "The user doesn't want to proceed with this tool use. The tool use was rejected (it did not run). To tell you how to proceed, the user said:\nuse a copy"
          }
        }
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

  // #21306: the MCP adapter's toModelOutput must forward image/audio blocks as structured
  // media so the capability pipeline (routeToolResultMedia) can decide per model + wire —
  // forward when the model accepts them, an honest omission note when it doesn't.
  const mcpMediaTool = tool({
    inputSchema: z.object({}),
    toModelOutput: ({ output }) => mcpResultToModelOutput(output)
  })
  const mcpMediaMessages = (content: unknown[]) => [
    ui('assistant', [
      {
        type: 'tool-read_media',
        toolCallId: 'call-media-1',
        state: 'output-available',
        input: {},
        output: { content }
      }
    ]),
    ui('user', [{ type: 'text', text: 'describe it' }], 'u1')
  ]

  it('forwards tool-result images to a vision-capable model on a media-capable wire', async () => {
    const imageData = 'A'.repeat(1024)
    const model = await toModelMessages(
      mcpMediaMessages([{ type: 'image', data: imageData, mimeType: 'image/png' }]),
      { image: true, video: true, audio: true },
      { read_media: mcpMediaTool },
      { image: true, video: true, audio: true }
    )
    const text = JSON.stringify(model)
    expect(text).not.toContain('delivered to user')
    expect(text).toContain(imageData)
  })

  it('replaces tool-result media with an honest note for a non-vision model', async () => {
    const imageData = 'A'.repeat(1024)
    const model = await toModelMessages(
      mcpMediaMessages([{ type: 'image', data: imageData, mimeType: 'image/png' }]),
      { image: false, video: true, audio: true },
      { read_media: mcpMediaTool },
      { image: false, video: true, audio: true }
    )
    const text = JSON.stringify(model)
    expect(text).not.toContain('delivered to user')
    expect(text).not.toContain(imageData)
    expect(text).toContain('image attachment omitted')
  })

  it('gates tool-result audio for a model without audio input', async () => {
    const model = await toModelMessages(
      mcpMediaMessages([{ type: 'audio', data: 'QUFB', mimeType: 'audio/wav' }]),
      { image: true, video: true, audio: false },
      { read_media: mcpMediaTool },
      { image: true, video: true, audio: false }
    )
    const text = JSON.stringify(model)
    expect(text).not.toContain('delivered to user')
    expect(text).toContain('audio attachment omitted')
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

describe('non-object historical tool inputs', () => {
  const malformed = '{"query":'
  const text = { type: 'text', text: 'kept' } as const
  const bad = {
    type: 'dynamic-tool',
    toolName: 'lookup',
    toolCallId: 'bad',
    state: 'output-error',
    input: malformed,
    errorText: 'Invalid arguments'
  } as const
  const goodInput = { query: 'hello', options: { flags: [true, false] } }
  const good = {
    type: 'dynamic-tool',
    toolName: 'lookup',
    toolCallId: 'good',
    state: 'output-available',
    input: goodInput,
    output: { found: true }
  } as const
  const goodCall = {
    type: 'tool-call',
    toolCallId: 'good',
    toolName: 'lookup',
    input: goodInput,
    providerExecuted: undefined
  }
  const goodResult = {
    type: 'tool-result',
    toolCallId: 'good',
    toolName: 'lookup',
    output: { type: 'json', value: { found: true } }
  }
  const staticBad = {
    type: 'tool-lookup',
    toolCallId: 'bad',
    state: 'output-error',
    rawInput: malformed,
    errorText: 'Invalid arguments'
  } as const

  it.each([
    ['dynamic input', bad],
    ['static rawInput', staticBad]
  ])('drops the reported %s poison and its result while retaining surrounding text', async (_label, part) => {
    const model = await toModelMessages([
      ui('user', [{ type: 'text', text: 'before' }]),
      ui('assistant', [text, part as UIMessage['parts'][number]]),
      ui('user', [{ type: 'text', text: 'after' }])
    ])
    expect(model).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'before' }] },
      { role: 'assistant', content: [text] },
      { role: 'user', content: [{ type: 'text', text: 'after' }] }
    ])
    expect(
      await toModelMessages([
        ui('user', [{ type: 'text', text: 'before' }]),
        ui('assistant', [part as UIMessage['parts'][number]]),
        ui('user', [{ type: 'text', text: 'after' }])
      ])
    ).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'before' },
          { type: 'text', text: 'after' }
        ]
      }
    ])
  })

  it.each([
    ['absent', undefined],
    ['null', null],
    ['malformed string', malformed],
    ['JSON string', '{"query":"x"}'],
    ['empty string', ''],
    ['array', []],
    ['boolean', false],
    ['number', 0]
  ])('drops %s effective inputs with both failed and successful results', async (_label, input) => {
    for (const state of ['output-error', 'output-available'] as const) {
      const part = state === 'output-error' ? { ...bad, input } : { ...good, toolCallId: 'bad', input }
      if (input === undefined) Reflect.deleteProperty(part, 'input')
      expect(await toModelMessages([ui('assistant', [text, part])])).toEqual([{ role: 'assistant', content: [text] }])
    }
  })

  it.each([
    { label: 'object input wins over malformed rawInput', input: { query: 'x' }, rawInput: malformed, kept: true },
    { label: 'null input falls back to object rawInput', input: null, rawInput: { query: 'x' }, kept: true },
    { label: 'absent input falls back to object rawInput', input: undefined, rawInput: { query: 'x' }, kept: true },
    {
      label: 'non-nullish malformed input blocks object rawInput',
      input: malformed,
      rawInput: { query: 'x' },
      kept: false
    }
  ])('protects error precedence: $label', async ({ input, rawInput, kept }) => {
    const model = await toModelMessages([ui('assistant', [{ ...staticBad, input, rawInput }])])
    expect(model).toEqual(
      kept
        ? [
            {
              role: 'assistant',
              content: [
                {
                  type: 'tool-call',
                  toolCallId: 'bad',
                  toolName: 'lookup',
                  input: { query: 'x' },
                  providerExecuted: undefined
                }
              ]
            },
            {
              role: 'tool',
              content: [
                {
                  type: 'tool-result',
                  toolCallId: 'bad',
                  toolName: 'lookup',
                  output: { type: 'error-text', value: 'Invalid arguments' }
                }
              ]
            }
          ]
        : []
    )
  })

  it('does not fall back to rawInput for a successful result', async () => {
    const part = { ...good, input: null, rawInput: { query: 'x' } }
    expect(await toModelMessages([ui('assistant', [part])])).toEqual([])
  })

  it('preserves a normal success pair, nested arrays and input bytes beside poison', async () => {
    const bytes = JSON.stringify(goodInput)
    const model = await toModelMessages([ui('assistant', [bad, good])])
    expect(model).toEqual([
      { role: 'assistant', content: [goodCall] },
      { role: 'tool', content: [goodResult] }
    ])
    expect((model[0].content[0] as { input: unknown }).input).toBe(goodInput)
    expect(JSON.stringify((model[0].content[0] as { input: unknown }).input)).toBe(bytes)
  })

  it.each([{}, { wrongKey: true }])(
    'keeps object-valued errors without consulting the tool schema: %j',
    async (input) => {
      const model = await toModelMessages([ui('assistant', [{ ...bad, input }])], undefined, {
        lookup: tool({ inputSchema: z.object({ query: z.string() }) })
      })
      expect(model).toEqual([
        {
          role: 'assistant',
          content: [{ type: 'tool-call', toolCallId: 'bad', toolName: 'lookup', input, providerExecuted: undefined }]
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'bad',
              toolName: 'lookup',
              output: { type: 'error-text', value: 'Invalid arguments' }
            }
          ]
        }
      ])
    }
  )

  it('keeps legacy text/call/result/text ordering after removing a bad pair', async () => {
    const tail = { type: 'text', text: 'after' } as const
    expect(await toModelMessages([ui('assistant', [text, bad, good, tail])])).toEqual([
      { role: 'assistant', content: [text, goodCall] },
      { role: 'tool', content: [goodResult] },
      { role: 'assistant', content: [tail] }
    ])
  })

  it('avoids a ghost result and inferred boundary when only a bad tool separates texts', async () => {
    const tail = { type: 'text', text: 'after' } as const
    expect(await toModelMessages([ui('assistant', [text, bad, tail])])).toEqual([
      { role: 'assistant', content: [text, tail] }
    ])
  })

  it.each([
    { state: 'approval-responded', approved: true },
    { state: 'approval-responded', approved: false },
    { state: 'output-denied', approved: false }
  ] as const)(
    'drops malformed $state (approved=$approved) with all approval/result entries',
    async ({ state, approved }) => {
      const part = {
        type: 'dynamic-tool',
        toolName: 'lookup',
        toolCallId: 'bad',
        input: malformed,
        state,
        approval: { id: 'approval-bad', approved, reason: 'no' }
      } as UIMessage['parts'][number]
      expect(await toModelMessages([ui('assistant', [text, part])])).toEqual([{ role: 'assistant', content: [text] }])
    }
  )

  it('drops malformed provider-executed tools and preserves valid call/result placement and metadata', async () => {
    const callMetadata = { anthropic: { cacheControl: { type: 'ephemeral' } } }
    const resultMetadata = { anthropic: { marker: 'result' } }
    const model = await toModelMessages([
      ui('assistant', [
        { ...bad, providerExecuted: true },
        { ...good, providerExecuted: true, callProviderMetadata: callMetadata, resultProviderMetadata: resultMetadata }
      ])
    ])
    expect(model).toEqual([
      {
        role: 'assistant',
        content: [
          { ...goodCall, providerExecuted: true, providerOptions: callMetadata },
          { ...goodResult, providerOptions: resultMetadata }
        ]
      }
    ])
    expect((model[0].content[0] as { providerOptions: unknown }).providerOptions).toBe(callMetadata)
    expect((model[0].content[1] as { providerOptions: unknown }).providerOptions).toBe(resultMetadata)
  })

  it('leaves frozen history unchanged and replays mixed and already-clean fixtures identically twice', async () => {
    function freeze(value: unknown): void {
      if (value === null || typeof value !== 'object') return
      Object.values(value).forEach(freeze)
      Object.freeze(value)
    }
    const metadata = { source: { trace: 'original' } }
    const rawInput = { query: 'fallback' }
    const poison = { ...bad, rawInput, callProviderMetadata: metadata }
    const messages = [ui('assistant', [poison, good])]
    const original = structuredClone(messages)
    freeze(messages)
    const first = await toModelMessages(messages)
    expect(first).toEqual([
      { role: 'assistant', content: [goodCall] },
      { role: 'tool', content: [goodResult] }
    ])
    expect(await toModelMessages(messages)).toEqual(first)
    expect(messages).toEqual(original)
    expect(messages[0].parts[1]).toBe(good)
    expect((first[0].content[0] as { input: unknown }).input).toBe(goodInput)
    const clean = [ui('assistant', [good])]
    freeze(clean)
    expect(await toModelMessages(clean)).toEqual(first)
    expect(await toModelMessages(clean)).toEqual(first)
    expect(clean[0].parts[0]).toBe(good)
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
