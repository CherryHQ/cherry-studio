import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
import type { LanguageModelMiddleware } from 'ai'
import { describe, expect, it, vi } from 'vitest'

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

function buildSourceStream(deltas: string[], finishReasonUnified: 'stop' | 'tool-calls' = 'stop') {
  const parts: LanguageModelV3StreamPart[] = [
    { type: 'stream-start', warnings: [] },
    { type: 'text-start', id: 'text-1' },
    ...deltas.map<LanguageModelV3StreamPart>((delta) => ({
      type: 'text-delta',
      id: 'text-1',
      delta
    })),
    { type: 'text-end', id: 'text-1' },
    {
      type: 'finish',
      finishReason: { unified: finishReasonUnified, raw: finishReasonUnified },

      usage: {} as any
    }
  ]

  return new ReadableStream<LanguageModelV3StreamPart>({
    start(controller) {
      for (const part of parts) controller.enqueue(part)
      controller.close()
    }
  })
}

async function runStream(deltas: string[], finishReasonUnified: 'stop' | 'tool-calls' = 'stop') {
  const middleware = await getMiddleware()
  expect(middleware.wrapStream).toBeDefined()

  const source = buildSourceStream(deltas, finishReasonUnified)
  const wrapped = await middleware.wrapStream!({
    doStream: async () => ({ stream: source, request: { body: {} }, response: { headers: {} } }),

    doGenerate: (async () => ({})) as any,

    params: {} as any,

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
})
