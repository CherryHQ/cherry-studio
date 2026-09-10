import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { type LanguageModelMiddleware, streamText, tool, wrapLanguageModel } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { describe, expect, it, vi } from 'vitest'
import * as z from 'zod'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn()
    })
  }
}))

import { createDeepseekDsmlParserPlugin } from '../deepseekDsmlParserPlugin'

async function getMiddleware(): Promise<LanguageModelMiddleware> {
  const plugin = createDeepseekDsmlParserPlugin()
  const ctx = { middlewares: [] as LanguageModelMiddleware[] }
  // configureContext mutates ctx.middlewares by pushing the parser middleware
  await plugin.configureContext?.(ctx as any)
  expect(ctx.middlewares).toHaveLength(1)
  return ctx.middlewares[0]
}

function buildSourceStream(
  deltas: string[],
  finishReasonUnified: 'stop' | 'tool-calls' = 'stop',
  contentType: 'text' | 'reasoning' = 'text'
) {
  const startType = contentType === 'text' ? 'text-start' : 'reasoning-start'
  const deltaType = contentType === 'text' ? 'text-delta' : 'reasoning-delta'
  const endType = contentType === 'text' ? 'text-end' : 'reasoning-end'
  const parts: LanguageModelV3StreamPart[] = [
    { type: 'stream-start', warnings: [] },
    { type: startType, id: 'content-1' },
    ...deltas.map<LanguageModelV3StreamPart>((delta) => ({
      type: deltaType,
      id: 'content-1',
      delta
    })),
    { type: endType, id: 'content-1' },
    {
      type: 'finish',
      finishReason: { unified: finishReasonUnified, raw: finishReasonUnified },

      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 }
      }
    }
  ]

  return new ReadableStream<LanguageModelV3StreamPart>({
    start(controller) {
      for (const part of parts) controller.enqueue(part)
      controller.close()
    }
  })
}

async function runStream(
  deltas: string[],
  finishReasonUnified: 'stop' | 'tool-calls' = 'stop',
  toolNames: string[] = [],
  contentType: 'text' | 'reasoning' = 'text'
) {
  return runSourceStream(buildSourceStream(deltas, finishReasonUnified, contentType), toolNames)
}

async function runSourceStream(source: ReadableStream<LanguageModelV3StreamPart>, toolNames: string[] = []) {
  const middleware = await getMiddleware()
  expect(middleware.wrapStream).toBeDefined()

  const wrapped = await middleware.wrapStream!({
    doStream: async () => ({ stream: source, request: { body: {} }, response: { headers: {} } }),

    doGenerate: (async () => ({})) as any,

    params: { tools: toolNames.map((name) => ({ name })) } as any,

    model: {} as any
  } as any)

  const events: LanguageModelV3StreamPart[] = []
  const reader = wrapped.stream.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    events.push(value)
  }
  return events
}

// The actual chunk sequence captured from the user's DeepSeek SSE leak.
// Concatenated this is two parallel builtin_web_search invokes inside one tool_calls block.
const SSE_DELTAS: string[] = [
  // <｜｜DSML｜｜tool_calls>
  '<',
  '｜｜DSML｜｜',
  'tool',
  '_c',
  'alls',
  '>\n',
  // <｜｜DSML｜｜invoke name="builtin_web_search">
  '<',
  '｜｜DSML｜｜',
  'inv',
  'oke',
  ' name',
  '="',
  'built',
  'in',
  '_',
  'web',
  '_search',
  '">\n',
  // <｜｜DSML｜｜parameter name="additionalContext" string="true">
  '<',
  '｜｜DSML｜｜',
  'parameter',
  ' name',
  '="',
  'additional',
  'Context',
  '"',
  ' string',
  '="',
  'true',
  '">',
  // value (Chinese keywords)
  '企',
  '查',
  '查',
  ' ',
  '融资',
  '轮',
  '次',
  ' ',
  '天使',
  '轮',
  ' A',
  '轮',
  ' B',
  '轮',
  ' ',
  '投资',
  ' ',
  '金额',
  ' ',
  '时间',
  // </｜｜DSML｜｜parameter>
  '</',
  '｜｜DSML｜｜',
  'parameter',
  '>\n',
  // </｜｜DSML｜｜invoke>
  '</',
  '｜｜DSML｜｜',
  'inv',
  'oke',
  '>\n',
  // <｜｜DSML｜｜invoke name="builtin_web_search">
  '<',
  '｜｜DSML｜｜',
  'inv',
  'oke',
  ' name',
  '="',
  'built',
  'in',
  '_',
  'web',
  '_search',
  '">\n',
  // <｜｜DSML｜｜parameter name="additionalContext" string="true">
  '<',
  '｜｜DSML｜｜',
  'parameter',
  ' name',
  '="',
  'additional',
  'Context',
  '"',
  ' string',
  '="',
  'true',
  '">',
  // value (English keywords)
  '企',
  '查',
  '查',
  ' Q',
  'ich',
  'acha',
  ' funding',
  ' rounds',
  ' series',
  ' A',
  ' B',
  ' C',
  ' investors',
  ' amount',
  // </｜｜DSML｜｜parameter>
  '</',
  '｜｜DSML｜｜',
  'parameter',
  '>\n',
  // </｜｜DSML｜｜invoke>
  '</',
  '｜｜DSML｜｜',
  'inv',
  'oke',
  '>\n',
  // </｜｜DSML｜｜tool_calls>
  '</',
  '｜｜DSML｜｜',
  'tool',
  '_c',
  'alls',
  '>'
]

describe('deepseekDsmlParserPlugin', () => {
  it('converts single-bar DSML emitted by DeepSeek into a tool call', async () => {
    const events = await runStream([
      '我来帮您查询 Cherry Studio 的最新版本。让我先加载相关工具。\n\n',
      '<｜DSML｜tool_calls>\n',
      '<｜DSML｜invoke name="ToolSearch">\n',
      '<｜DSML｜parameter name="query" string="true">select:mcp__assistant__product_info,mcp__cherry-tools__web_search</｜DSML｜parameter>\n',
      '</｜DSML｜invoke>\n',
      '</｜DSML｜tool_calls>'
    ])

    const toolCalls = events.filter((event) => event.type === 'tool-call')
    expect(toolCalls).toHaveLength(1)
    expect(toolCalls[0]).toMatchObject({
      type: 'tool-call',
      toolName: 'ToolSearch'
    })
    expect(JSON.parse(toolCalls[0].input)).toEqual({
      query: 'select:mcp__assistant__product_info,mcp__cherry-tools__web_search'
    })

    const text = events
      .filter((event) => event.type === 'text-delta')
      .map((event) => event.delta)
      .join('')
    expect(text).toBe('我来帮您查询 Cherry Studio 的最新版本。让我先加载相关工具。\n\n')
  })

  it('converts DSML emitted inside DeepSeek reasoning without requiring another model turn', async () => {
    const events = await runStream(
      [
        'Let me load the tool.\n',
        '<｜DSML｜tool_calls>',
        '<｜DSML｜invoke name="ToolSearch">',
        '<｜DSML｜parameter name="query" string="true">select:mcp__assistant__product_info</｜DSML｜parameter>',
        '</｜DSML｜invoke>',
        '</｜DSML｜tool_calls>'
      ],
      'stop',
      ['ToolSearch'],
      'reasoning'
    )

    expect(
      events
        .filter((event) => event.type === 'reasoning-delta')
        .map((event) => event.delta)
        .join('')
    ).toBe('Let me load the tool.\n')
    expect(events.find((event) => event.type === 'tool-call')).toMatchObject({
      type: 'tool-call',
      toolName: 'ToolSearch',
      input: '{"query":"select:mcp__assistant__product_info"}'
    })
    expect(events.findIndex((event) => event.type === 'reasoning-end')).toBeLessThan(
      events.findIndex((event) => event.type === 'tool-call')
    )
    expect(events.find((event) => event.type === 'finish')).toMatchObject({
      finishReason: { unified: 'tool-calls' }
    })
  })

  it('keeps buffered reasoning content in the reasoning channel when text starts before reasoning ends', async () => {
    const partialDsml = '<｜DSML｜tool_'
    const parts: LanguageModelV3StreamPart[] = [
      { type: 'stream-start', warnings: [] },
      { type: 'reasoning-start', id: 'reasoning-0' },
      { type: 'reasoning-delta', id: 'reasoning-0', delta: `thinking\n${partialDsml}` },
      { type: 'text-start', id: 'txt-0' },
      { type: 'text-delta', id: 'txt-0', delta: 'answer' },
      { type: 'reasoning-end', id: 'reasoning-0' },
      { type: 'text-end', id: 'txt-0' },
      {
        type: 'finish',
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 1, text: 1, reasoning: 0 }
        }
      }
    ]
    const events = await runSourceStream(
      new ReadableStream<LanguageModelV3StreamPart>({
        start(controller) {
          for (const part of parts) controller.enqueue(part)
          controller.close()
        }
      })
    )

    expect(
      events
        .filter((event) => event.type === 'reasoning-delta')
        .filter((event) => event.id === 'reasoning-0')
        .map((event) => event.delta)
        .join('')
    ).toBe(`thinking\n${partialDsml}`)
    expect(events.filter((event) => event.type === 'text-delta')).toEqual([
      { type: 'text-delta', id: 'txt-0', delta: 'answer' }
    ])
  })

  it('converts the ToolSearch tool-tag variant emitted by DeepSeek into a tool call', async () => {
    const events = await runStream([
      '<｜DSML｜tool_calls>\n',
      '<｜DSML｜tool name="ToolSearch">\n',
      '<｜DSML｜parameter name="query" string="true">select:mcp__assistant__product_info</｜DSML｜parameter>\n',
      '</｜DSML｜tool>\n',
      '</｜DSML｜tool_calls>'
    ])

    expect(events.find((event) => event.type === 'tool-call')).toMatchObject({
      type: 'tool-call',
      toolName: 'ToolSearch',
      input: '{"query":"select:mcp__assistant__product_info"}'
    })
  })

  it('converts the tool_invoke opening-tag variant emitted by DeepSeek', async () => {
    const events = await runStream([
      '<｜DSML｜tool_calls>\n',
      '<｜DSML｜tool_invoke name="ToolSearch">\n',
      '<｜DSML｜parameter name="query" string="true">select:mcp__assistant__product_info</｜DSML｜parameter>\n',
      '</｜DSML｜invoke>\n',
      '</｜DSML｜tool_calls>'
    ])

    expect(events.find((event) => event.type === 'tool-call')).toMatchObject({
      type: 'tool-call',
      toolName: 'ToolSearch',
      input: '{"query":"select:mcp__assistant__product_info"}'
    })
  })

  it('converts the captured Tool loop search variant when ToolSearch is available', async () => {
    const events = await runStream(
      ['\n\n<｜DSML｜Tool loop>\n', '<search>select:mcp__assistant__product_info</search>\n', '</｜DSML｜Tool>'],
      'stop',
      ['ToolSearch']
    )

    expect(events.find((event) => event.type === 'tool-call')).toMatchObject({
      type: 'tool-call',
      toolName: 'ToolSearch',
      input: '{"query":"select:mcp__assistant__product_info"}'
    })
    expect(
      events
        .filter((event) => event.type === 'text-delta')
        .map((event) => event.delta)
        .join('')
    ).toBe('\n\n')
    expect(events.find((event) => event.type === 'finish')).toMatchObject({
      finishReason: { unified: 'tool-calls' }
    })
  })

  it('preserves the Tool loop search variant when ToolSearch is unavailable', async () => {
    const text = '<｜DSML｜Tool loop>\n<search>select:mcp__assistant__product_info</search>\n</｜DSML｜Tool>'
    const events = await runStream([text])

    expect(events.filter((event) => event.type === 'tool-call')).toHaveLength(0)
    expect(
      events
        .filter((event) => event.type === 'text-delta')
        .map((event) => event.delta)
        .join('')
    ).toBe(text)
  })

  it('restores Claude built-in tool casing when the schema-less tool is absent from request tools', async () => {
    const events = await runStream([
      '<｜DSML｜tool_calls>',
      '<｜DSML｜invoke name="skill">',
      '<｜DSML｜parameter name="skill" string="true">cherry-assistant-guide</｜DSML｜parameter>',
      '</｜DSML｜invoke>',
      '</｜DSML｜tool_calls>'
    ])

    expect(events.find((event) => event.type === 'tool-call')).toMatchObject({
      type: 'tool-call',
      toolName: 'Skill'
    })
  })

  it('produces an executable AI SDK tool call from valid DSML input', async () => {
    const middleware = await getMiddleware()
    const model = wrapLanguageModel({
      model: new MockLanguageModelV3({
        doStream: async () => ({
          stream: buildSourceStream([
            '<｜DSML｜tool_calls>',
            '<｜DSML｜invoke name="mcp__assistant__product_info">',
            '<｜DSML｜parameter name="source" string="true">manifest</｜DSML｜parameter>',
            '</｜DSML｜invoke>',
            '</｜DSML｜tool_calls>'
          ])
        })
      }),
      middleware
    })
    const result = streamText({
      model,
      prompt: 'query the version',
      tools: {
        mcp__assistant__product_info: tool({
          inputSchema: z.object({ source: z.literal('manifest') })
        })
      }
    })

    let toolCall: { toolName: string; input: unknown } | undefined
    let hasToolError = false
    for await (const part of result.fullStream) {
      if (part.type === 'tool-call') toolCall = { toolName: part.toolName, input: part.input }
      if (part.type === 'tool-error') hasToolError = true
    }

    expect(toolCall).toMatchObject({
      toolName: 'mcp__assistant__product_info',
      input: { source: 'manifest' }
    })
    expect(hasToolError).toBe(false)
  })

  it('converts the captured SSE sample into two AI SDK tool-call events', async () => {
    const events = await runStream(SSE_DELTAS, 'stop')

    const toolCalls = events.filter((e) => e.type === 'tool-call')
    expect(toolCalls).toHaveLength(2)

    expect(toolCalls[0]).toMatchObject({
      type: 'tool-call',
      toolName: 'builtin_web_search'
    })
    expect(toolCalls[1]).toMatchObject({
      type: 'tool-call',
      toolName: 'builtin_web_search'
    })

    const args0 = JSON.parse(toolCalls[0].input)
    const args1 = JSON.parse(toolCalls[1].input)
    expect(args0).toEqual({
      additionalContext: '企查查 融资轮次 天使轮 A轮 B轮 投资 金额 时间'
    })
    expect(args1).toEqual({
      additionalContext: '企查查 Qichacha funding rounds series A B C investors amount'
    })
  })

  it('emits the streaming tool-input lifecycle around each tool-call', async () => {
    const events = await runStream(SSE_DELTAS, 'stop')

    const lifecycle = events.filter((e) =>
      ['tool-input-start', 'tool-input-delta', 'tool-input-end', 'tool-call'].includes(e.type)
    )
    // 4 events per tool-call * 2 invokes = 8 lifecycle events
    expect(lifecycle).toHaveLength(8)
    expect(lifecycle.map((e) => e.type)).toEqual([
      'tool-input-start',
      'tool-input-delta',
      'tool-input-end',
      'tool-call',
      'tool-input-start',
      'tool-input-delta',
      'tool-input-end',
      'tool-call'
    ])

    // tool-input-start id matches the corresponding tool-call's toolCallId
    const start0 = lifecycle[0] as Extract<LanguageModelV3StreamPart, { type: 'tool-input-start' }>
    const call0 = lifecycle[3] as Extract<LanguageModelV3StreamPart, { type: 'tool-call' }>
    expect(start0.id).toBe(call0.toolCallId)
  })

  it('rewrites finishReason from stop to tool-calls when DSML produced tool calls', async () => {
    const events = await runStream(SSE_DELTAS, 'stop')
    const finish = events.find((e) => e.type === 'finish') as Extract<LanguageModelV3StreamPart, { type: 'finish' }>
    expect(finish.finishReason.unified).toBe('tool-calls')
  })

  it('does not emit any text-delta with the DSML opening tag leaked', async () => {
    const events = await runStream(SSE_DELTAS, 'stop')
    const textDeltas = events.filter((e) => e.type === 'text-delta')
    const concatenated = textDeltas.map((e) => e.delta).join('')
    expect(concatenated).not.toContain('｜｜DSML｜｜')
    expect(concatenated).not.toContain('<｜')
    // No spurious text content in this fully-DSML fragment
    expect(concatenated).toBe('')
  })

  it('preserves plain text before and after the DSML block', async () => {
    const deltas = ['让我先搜索一下。', ...SSE_DELTAS, '\n搜索完成。']
    const events = await runStream(deltas, 'stop')

    const textDeltas = events
      .filter((e) => e.type === 'text-delta')
      .map((e) => e.delta)
      .join('')
    expect(textDeltas).toBe('让我先搜索一下。\n搜索完成。')

    const toolCalls = events.filter((e) => e.type === 'tool-call')
    expect(toolCalls).toHaveLength(2)
  })

  it('passes plain text streams through unchanged when no DSML appears', async () => {
    const events = await runStream(['Hello, ', 'world!'], 'stop')
    const textDeltas = events
      .filter((e) => e.type === 'text-delta')
      .map((e) => e.delta)
      .join('')
    expect(textDeltas).toBe('Hello, world!')
    expect(events.filter((e) => e.type === 'tool-call')).toHaveLength(0)

    const finish = events.find((e) => e.type === 'finish') as Extract<LanguageModelV3StreamPart, { type: 'finish' }>
    expect(finish.finishReason.unified).toBe('stop')
  })

  it('flushes unclosed DSML block as plain text on text-end (fallback)', async () => {
    const deltas = [
      '<',
      '｜｜DSML｜｜',
      'tool',
      '_calls',
      '>\n',
      '<',
      '｜｜DSML｜｜',
      'invoke name="x">'
      // no close tag
    ]
    const events = await runStream(deltas, 'stop')

    expect(events.filter((e) => e.type === 'tool-call')).toHaveLength(0)
    const textDeltas = events
      .filter((e) => e.type === 'text-delta')
      .map((e) => e.delta)
      .join('')
    expect(textDeltas).toContain('<｜｜DSML｜｜tool_calls>')
  })

  it('emits the original DSML markup as text when a closed block has no parseable invoke', async () => {
    // Closed tool_calls block, but the inner content does not match an invoke pattern
    // (e.g. malformed or unexpected payload). The parser should not silently swallow it.
    const deltas = [
      'before ',
      '<｜｜DSML｜｜tool_calls>',
      'oops not a valid invoke',
      '</｜｜DSML｜｜tool_calls>',
      ' after'
    ]
    const events = await runStream(deltas, 'stop')

    expect(events.filter((e) => e.type === 'tool-call')).toHaveLength(0)

    const text = events
      .filter((e) => e.type === 'text-delta')
      .map((e) => e.delta)
      .join('')
    expect(text).toBe('before <｜｜DSML｜｜tool_calls>oops not a valid invoke</｜｜DSML｜｜tool_calls> after')

    const finish = events.find((e) => e.type === 'finish') as Extract<LanguageModelV3StreamPart, { type: 'finish' }>
    expect(finish.finishReason.unified).toBe('stop')
  })

  it('handles a partial DSML opening tag that arrives across chunk boundaries with surrounding text', async () => {
    // First emit some plain text, then split the open tag character-by-character
    const deltas = [
      'prefix ',
      '<',
      '｜',
      '｜',
      'D',
      'S',
      'M',
      'L',
      '｜',
      '｜',
      'tool_calls',
      '>',
      '<｜｜DSML｜｜invoke name="t">',
      '<｜｜DSML｜｜parameter name="p" string="true">v</｜｜DSML｜｜parameter>',
      '</｜｜DSML｜｜invoke>',
      '</｜｜DSML｜｜tool_calls>',
      ' suffix'
    ]
    const events = await runStream(deltas, 'stop')

    const toolCalls = events.filter((e) => e.type === 'tool-call')
    expect(toolCalls).toHaveLength(1)
    expect(toolCalls[0].toolName).toBe('t')
    expect(JSON.parse(toolCalls[0].input)).toEqual({ p: 'v' })

    const text = events
      .filter((e) => e.type === 'text-delta')
      .map((e) => e.delta)
      .join('')
    expect(text).toBe('prefix  suffix')
  })

  describe('wrapGenerate (non-streaming)', () => {
    async function runGenerate(
      text: string,
      finishReasonUnified: 'stop' | 'tool-calls' = 'stop',
      contentType: 'text' | 'reasoning' = 'text'
    ) {
      const middleware = await getMiddleware()
      expect(middleware.wrapGenerate).toBeDefined()

      const result = await middleware.wrapGenerate!({
        doGenerate: async () =>
          ({
            content: [{ type: contentType, text }],
            finishReason: { unified: finishReasonUnified, raw: finishReasonUnified },
            usage: {} as any,
            warnings: [],
            request: { body: {} },
            response: { headers: {} }
          }) as any,

        doStream: (async () => ({})) as any,

        params: {} as any,

        model: {} as any
      } as any)

      return result as any
    }

    it('extracts multiple DSML blocks within a single text part', async () => {
      const text =
        'lead-in ' +
        '<｜｜DSML｜｜tool_calls>' +
        '<｜｜DSML｜｜invoke name="search_a">' +
        '<｜｜DSML｜｜parameter name="q" string="true">first</｜｜DSML｜｜parameter>' +
        '</｜｜DSML｜｜invoke>' +
        '</｜｜DSML｜｜tool_calls>' +
        ' middle ' +
        '<｜｜DSML｜｜tool_calls>' +
        '<｜｜DSML｜｜invoke name="search_b">' +
        '<｜｜DSML｜｜parameter name="q" string="true">second</｜｜DSML｜｜parameter>' +
        '</｜｜DSML｜｜invoke>' +
        '</｜｜DSML｜｜tool_calls>' +
        ' tail'

      const result = await runGenerate(text, 'stop')

      const toolCalls = result.content.filter((p: any) => p.type === 'tool-call')
      expect(toolCalls).toHaveLength(2)
      expect(toolCalls[0].toolName).toBe('search_a')
      expect(JSON.parse(toolCalls[0].input)).toEqual({ q: 'first' })
      expect(toolCalls[1].toolName).toBe('search_b')
      expect(JSON.parse(toolCalls[1].input)).toEqual({ q: 'second' })

      const reconstructed = result.content
        .filter((p: any) => p.type === 'text')
        .map((p: any) => p.text)
        .join('')
      expect(reconstructed).toBe('lead-in  middle  tail')
      expect(reconstructed).not.toContain('｜｜DSML｜｜')

      expect(result.finishReason.unified).toBe('tool-calls')
    })

    it('extracts DSML tool calls from reasoning parts', async () => {
      const text =
        'thinking ' +
        '<｜DSML｜tool_calls>' +
        '<｜DSML｜invoke name="ToolSearch">' +
        '<｜DSML｜parameter name="query" string="true">select:mcp__assistant__product_info</｜DSML｜parameter>' +
        '</｜DSML｜invoke>' +
        '</｜DSML｜tool_calls>'

      const result = await runGenerate(text, 'stop', 'reasoning')

      expect(result.content).toEqual([
        { type: 'reasoning', text: 'thinking ' },
        expect.objectContaining({
          type: 'tool-call',
          toolName: 'ToolSearch',
          input: '{"query":"select:mcp__assistant__product_info"}'
        })
      ])
      expect(result.finishReason.unified).toBe('tool-calls')
    })

    it('preserves a closed DSML block that contains no parseable invoke as text', async () => {
      const text = 'before <｜｜DSML｜｜tool_calls>garbage</｜｜DSML｜｜tool_calls> after'
      const result = await runGenerate(text, 'stop')

      expect(result.content.filter((p: any) => p.type === 'tool-call')).toHaveLength(0)
      // Single text part returned unchanged
      expect(result.content).toHaveLength(1)
      expect(result.content[0]).toMatchObject({ type: 'text', text })
      expect(result.finishReason.unified).toBe('stop')
    })

    it('returns input unchanged when no DSML markup is present', async () => {
      const text = 'plain response'
      const result = await runGenerate(text, 'stop')
      expect(result.content).toHaveLength(1)
      expect(result.content[0]).toMatchObject({ type: 'text', text })
      expect(result.finishReason.unified).toBe('stop')
    })
  })
})
