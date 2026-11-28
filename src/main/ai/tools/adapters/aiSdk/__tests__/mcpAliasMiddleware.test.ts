import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { jsonSchema, type LanguageModelMiddleware, type ToolSet, type UIMessage } from 'ai'
import { describe, expect, it, vi } from 'vitest'

import { createMcpAliasMiddleware } from '../mcpAliasMiddleware'

const wire = 'mcp__server__lookup_digest'
const entry = {
  inputSchema: jsonSchema({ type: 'object' }),
  metadata: { cherry: { tool: { type: 'mcp', name: 'lookup' } } }
}
const tools: ToolSet = { [wire]: entry, tool_invoke: { inputSchema: jsonSchema({ type: 'object' }) } }

async function stream(middleware: LanguageModelMiddleware, parts: LanguageModelV3StreamPart[]) {
  const { MockLanguageModelV3 } = await import('ai/test')
  const wrapped = await middleware.wrapStream!({
    model: new MockLanguageModelV3(),
    params: { prompt: [] },
    doGenerate: async () => {
      throw new Error('not used in stream probe')
    },
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          parts.forEach((part) => controller.enqueue(part))
          controller.close()
        }
      })
    })
  })
  const result: LanguageModelV3StreamPart[] = []
  for await (const part of wrapped.stream) result.push(part)
  return result
}

describe('request-scoped MCP identity', () => {
  it('gives streaming start and final call the same canonical identity before SDK approval and history', async () => {
    const parts = await stream(createMcpAliasMiddleware(tools, tools), [
      { type: 'tool-input-start', id: 'call', toolName: 'lookup' },
      { type: 'tool-call', toolCallId: 'call', toolName: 'lookup', input: '{}' }
    ])
    expect(parts.map((part) => ('toolName' in part ? part.toolName : undefined))).toEqual([wire, wire])
  })

  it('persists a deferred alias as the resolved wire identity in tool_invoke input', async () => {
    const [part] = await stream(createMcpAliasMiddleware({ tool_invoke: tools.tool_invoke }, tools), [
      {
        type: 'tool-call',
        toolCallId: 'call',
        toolName: 'tool_invoke',
        input: JSON.stringify({ name: 'lookup', params: { q: 1 } })
      }
    ])
    expect(part.type === 'tool-call' && JSON.parse(part.input)).toEqual({ name: wire, params: { q: 1 } })
  })

  it('does not choose an inline namesake when a deferred server exposes the same alias', async () => {
    const [part] = await stream(createMcpAliasMiddleware(tools, { ...tools, mcp__other: entry }), [
      { type: 'tool-input-start', id: 'call', toolName: 'lookup' }
    ])
    expect(part).toMatchObject({ toolName: 'lookup' })
  })
})

it.each([false, true])('persists canonical SDK identity for follow-up and approval=%s', async (approval) => {
  const { readUIMessageStream, streamText, wrapLanguageModel } = await import('ai')
  const { MockLanguageModelV3, convertArrayToReadableStream } = await import('ai/test')
  const { toModelMessages } = await import('../../../../messages/messageRules')
  const execute = vi.fn(async () => ({
    content: [{ type: 'text', text: 'model-visible' }],
    _meta: { secret: 'app-only' }
  }))
  const formatter = vi.fn(() => ({ type: 'text' as const, value: 'model-visible' }))
  const callable: ToolSet = { [wire]: { ...entry, execute, toModelOutput: formatter, needsApproval: approval } }
  const model = wrapLanguageModel({
    model: new MockLanguageModelV3({
      doStream: async () => ({
        stream: convertArrayToReadableStream([
          { type: 'stream-start', warnings: [] },
          { type: 'tool-input-start', id: 'call', toolName: 'lookup' },
          { type: 'tool-input-delta', id: 'call', delta: '{}' },
          { type: 'tool-input-end', id: 'call' },
          { type: 'tool-call', toolCallId: 'call', toolName: 'lookup', input: '{}' },
          {
            type: 'finish',
            finishReason: { unified: 'tool-calls', raw: undefined },
            usage: {
              inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 1, text: 1, reasoning: 0 }
            }
          }
        ])
      })
    }),
    middleware: createMcpAliasMiddleware(callable, callable)
  })
  let saved: UIMessage | undefined
  for await (const message of readUIMessageStream({
    stream: streamText({ model, tools: callable, prompt: 'lookup', maxRetries: 0 }).toUIMessageStream()
  }))
    saved = message
  expect(saved).toBeDefined()
  const part = saved!.parts.find((part) => part.type === `tool-${wire}`)
  expect(part).toBeDefined()
  const persisted = JSON.parse(JSON.stringify(saved!))
  if (approval) {
    expect(part).toMatchObject({ state: 'approval-requested' })
    expect(execute).not.toHaveBeenCalled()
    const toolPart = persisted.parts.find((part: { type: string }) => part.type === `tool-${wire}`)
    toolPart.state = 'approval-responded'
    toolPart.approval.approved = true
    const replay = await toModelMessages([persisted], undefined, callable)
    expect(JSON.stringify(replay)).toContain(wire)
    expect(callable[wire].execute).toBe(execute)
    const resume = streamText({ model, tools: callable, messages: replay, maxRetries: 0 })
    await resume.consumeStream()
    expect(execute).toHaveBeenCalled()
  } else {
    const replay = await toModelMessages([persisted], undefined, callable)
    expect(formatter).toHaveBeenCalled()
    expect(JSON.stringify(replay)).toContain('model-visible')
    expect(JSON.stringify(replay)).not.toContain('app-only')
  }
})

it('replays deferred alias output through the same formatter after the request map is gone', async () => {
  const { ToolRegistry } = await import('../registry')
  const { createToolInvokeTool } = await import('../meta/toolInvoke')
  const { toModelMessages } = await import('../../../../messages/messageRules')
  const formatter = vi.fn(() => ({ type: 'text' as const, value: 'safe projection' }))
  const registry = new ToolRegistry()
  registry.register({
    name: wire,
    namespace: 'mcp:server',
    description: 'lookup',
    defer: 'auto',
    tool: { ...entry, toModelOutput: formatter }
  })
  const [canonical] = await stream(createMcpAliasMiddleware({ tool_invoke: tools.tool_invoke }, tools), [
    {
      type: 'tool-call',
      toolCallId: 'outer',
      toolName: 'tool_invoke',
      input: JSON.stringify({ name: 'lookup', params: {} })
    }
  ])
  if (canonical.type !== 'tool-call') throw new Error('expected call')
  const saved = {
    id: 'reply',
    role: 'assistant' as const,
    parts: [
      {
        type: 'tool-tool_invoke' as const,
        toolCallId: 'outer',
        state: 'output-available' as const,
        input: JSON.parse(canonical.input),
        output: { _meta: { secret: 'private app state' }, content: [] }
      }
    ]
  }
  const replayTool = createToolInvokeTool(registry, new Set([wire]), new Set())
  const replay = await toModelMessages([JSON.parse(JSON.stringify(saved))], undefined, { tool_invoke: replayTool })
  expect(formatter).toHaveBeenCalled()
  expect(JSON.stringify(replay)).toContain('safe projection')
  expect(JSON.stringify(replay)).not.toContain('private app state')
  // MCP App launch compares this persisted input name with its independently authorized wire ID.
  expect(saved.parts[0].input.name).toBe(wire)
})

it('overwrites streamed tool_invoke input with the canonical identity before persistence', async () => {
  const { readUIMessageStream, streamText, wrapLanguageModel } = await import('ai')
  const { MockLanguageModelV3, convertArrayToReadableStream } = await import('ai/test')
  const input = JSON.stringify({ name: 'lookup', params: {} })
  const model = wrapLanguageModel({
    model: new MockLanguageModelV3({
      doStream: async () => ({
        stream: convertArrayToReadableStream([
          { type: 'stream-start', warnings: [] },
          { type: 'tool-input-start', id: 'outer', toolName: 'tool_invoke' },
          { type: 'tool-input-delta', id: 'outer', delta: input },
          { type: 'tool-input-end', id: 'outer' },
          { type: 'tool-call', toolCallId: 'outer', toolName: 'tool_invoke', input },
          {
            type: 'finish',
            finishReason: { unified: 'tool-calls', raw: undefined },
            usage: {
              inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 1, text: 1, reasoning: 0 }
            }
          }
        ])
      })
    }),
    middleware: createMcpAliasMiddleware({ tool_invoke: tools.tool_invoke }, tools)
  })
  let saved: UIMessage | undefined
  const callable: ToolSet = { tool_invoke: { ...tools.tool_invoke, execute: async () => 'ok' } }
  for await (const message of readUIMessageStream({
    stream: streamText({ model, tools: callable, prompt: 'lookup', maxRetries: 0 }).toUIMessageStream()
  }))
    saved = message
  expect(saved?.parts).toContainEqual(
    expect.objectContaining({ type: 'tool-tool_invoke', state: 'output-available', input: { name: wire, params: {} } })
  )
})

it.each(['stream', 'generate'] as const)(
  'preserves native web-search identity through SDK %s with an MCP namesake',
  async (mode) => {
    const { openai } = await import('@ai-sdk/openai')
    const { generateText, readUIMessageStream, streamText, wrapLanguageModel } = await import('ai')
    const { MockLanguageModelV3, convertArrayToReadableStream } = await import('ai/test')
    const { toModelMessages } = await import('../../../../messages/messageRules')
    const mcpWire = 'mcp__server__webSearch_digest'
    const execute = vi.fn(async () => 'MCP result')
    const mcp: ToolSet = {
      [mcpWire]: {
        inputSchema: jsonSchema({ type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }),
        metadata: { cherry: { tool: { type: 'mcp', name: 'webSearch' } } },
        execute
      }
    }
    // Provider plugins add their tools separately from the request's MCP catalog.
    const callable: ToolSet = { ...mcp, webSearch: openai.tools.webSearch({}) }
    const call = {
      type: 'tool-call' as const,
      toolCallId: 'native',
      toolName: 'webSearch',
      input: '{}',
      providerExecuted: true
    }
    const output = { sources: [], action: { type: 'search', queries: ['example'] } }
    const result = { type: 'tool-result' as const, toolCallId: 'native', toolName: 'webSearch', result: output }
    const usage = {
      inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 1, text: 1, reasoning: 0 }
    }
    const finishReason = { unified: 'stop' as const, raw: undefined }
    const model = wrapLanguageModel({
      model: new MockLanguageModelV3({
        doGenerate: async () => ({ content: [call, result], finishReason, usage, warnings: [] }),
        doStream: async () => ({
          stream: convertArrayToReadableStream<LanguageModelV3StreamPart>([
            { type: 'stream-start', warnings: [] },
            { type: 'tool-input-start', id: 'native', toolName: 'webSearch', providerExecuted: true },
            { type: 'tool-input-delta', id: 'native', delta: '{}' },
            { type: 'tool-input-end', id: 'native' },
            call,
            result,
            { type: 'finish', finishReason, usage }
          ])
        })
      }),
      middleware: createMcpAliasMiddleware(mcp, mcp)
    })
    if (mode === 'generate') {
      const generated = await generateText({ model, tools: callable, prompt: 'search', maxRetries: 0 })
      expect(generated.toolCalls).toEqual([
        expect.objectContaining({ toolName: 'webSearch', providerExecuted: true, input: {} })
      ])
      expect(generated.toolResults).toEqual([expect.objectContaining({ toolName: 'webSearch', output })])
      expect(JSON.stringify(generated.response.messages)).not.toContain(mcpWire)
      expect(JSON.stringify(generated.response.messages)).toContain('webSearch')
    } else {
      let saved: UIMessage | undefined
      const response = streamText({ model, tools: callable, prompt: 'search', maxRetries: 0 })
      for await (const message of readUIMessageStream({ stream: response.toUIMessageStream() })) saved = message
      expect(saved?.parts).toContainEqual(
        expect.objectContaining({
          type: 'tool-webSearch',
          state: 'output-available',
          providerExecuted: true,
          input: {},
          output
        })
      )
      expect(saved?.parts.some((part) => part.type === `tool-${mcpWire}`)).toBe(false)
      const replay = await toModelMessages([JSON.parse(JSON.stringify(saved))], undefined, callable)
      expect(JSON.stringify(replay)).toContain('webSearch')
      expect(JSON.stringify(replay)).not.toContain(mcpWire)
      expect(await response.toolCalls).toEqual([
        expect.objectContaining({ toolName: 'webSearch', providerExecuted: true, input: {} })
      ])
    }
    expect(execute).not.toHaveBeenCalled()
  }
)
