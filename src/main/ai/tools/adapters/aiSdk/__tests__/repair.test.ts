import type { JSONSchema7, LanguageModelV3ToolCall } from '@ai-sdk/provider'
import { KB_SEARCH_TOOL_NAME } from '@shared/ai/builtinTools'
import { InvalidToolInputError, jsonSchema, NoSuchToolError } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as z from 'zod'

const { generateText } = vi.hoisted(() => ({ generateText: vi.fn() }))

vi.mock('@cherrystudio/ai-core', () => ({ generateText }))

import { createAiRepair } from '../repair'

const repair = createAiRepair({
  providerId: 'openai',
  providerSettings: { apiKey: 'test' },
  modelId: 'gpt-4o-mini'
})

const inputErr = new InvalidToolInputError({
  toolName: KB_SEARCH_TOOL_NAME,
  toolInput: '{}',
  cause: new Error('expected query, got q')
})

const noSuchToolErr = new NoSuchToolError({ toolName: 'mystery' })
const querySchema = z.object({ query: z.string() })

function makeToolCall(toolName: string, input: unknown): LanguageModelV3ToolCall {
  return {
    type: 'tool-call',
    toolCallType: 'function',
    toolCallId: 'tc-1',
    toolName,
    input: typeof input === 'string' ? input : JSON.stringify(input)
  } as unknown as LanguageModelV3ToolCall
}

async function callRepair(
  toolCall: LanguageModelV3ToolCall,
  error: InvalidToolInputError | NoSuchToolError = inputErr
) {
  return repair({
    system: undefined,
    messages: [],
    toolCall,
    tools: { [KB_SEARCH_TOOL_NAME]: { inputSchema: querySchema } } as never,
    inputSchema: async () => ({ type: 'object', properties: { query: { type: 'string' } } }) as never,
    error
  })
}

describe('createAiRepair', () => {
  beforeEach(() => generateText.mockReset())

  it('asks ai-core generateText with Output.object and returns the structured repair', async () => {
    generateText.mockResolvedValue({ output: { query: 'hello world' } })

    const repaired = await callRepair(makeToolCall(KB_SEARCH_TOOL_NAME, { q: 'hello world' }))

    expect(repaired).not.toBeNull()
    expect(JSON.parse(repaired!.input)).toEqual({ query: 'hello world' })
    expect(generateText).toHaveBeenCalledTimes(1)
    const [providerId, providerSettings, params] = generateText.mock.calls[0]
    expect(providerId).toBe('openai')
    expect(providerSettings).toEqual({ apiKey: 'test' })
    expect(params.model).toBe('gpt-4o-mini')
    expect(params.prompt).toContain(KB_SEARCH_TOOL_NAME)
    // Structured-output mode is engaged via output
    expect(params.output).toBeDefined()
  })

  it('unwraps a repair envelope only when the original tool schema validates its arguments', async () => {
    const complexSchema = z.object({
      paths: z.array(z.string()),
      options: z.object({ filters: z.array(z.object({ field: z.string(), values: z.array(z.string()) })) })
    })
    const expected = {
      paths: ['a.ts', 'b.ts'],
      options: { filters: [{ field: 'status', values: ['open', 'closed'] }] }
    }
    generateText.mockResolvedValue({ output: { arguments: expected } })

    const repaired = await repair({
      system: undefined,
      messages: [],
      toolCall: makeToolCall(KB_SEARCH_TOOL_NAME, { paths: 'a.ts' }),
      tools: { [KB_SEARCH_TOOL_NAME]: { inputSchema: complexSchema } } as never,
      inputSchema: async () => z.toJSONSchema(complexSchema) as never,
      error: inputErr
    })

    expect(repaired).not.toBeNull()
    expect(JSON.parse(repaired!.input)).toEqual(expected)
  })

  it('validates and unwraps repair envelopes for tools backed by JSON Schema', async () => {
    const schemaJson: JSONSchema7 = {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
      additionalProperties: false
    }
    generateText.mockResolvedValue({ output: { arguments: { query: 'hello world' } } })

    const repaired = await repair({
      system: undefined,
      messages: [],
      toolCall: makeToolCall('mcp_search', { q: 'hello world' }),
      tools: { mcp_search: { inputSchema: jsonSchema(schemaJson) } } as never,
      inputSchema: async () => schemaJson as never,
      error: inputErr
    })

    expect(repaired).not.toBeNull()
    expect(JSON.parse(repaired!.input)).toEqual({ query: 'hello world' })
  })

  it('fails closed when a JSON Schema cannot be converted for validation', async () => {
    const schemaJson = { not: { type: 'string' } } as const
    generateText.mockResolvedValue({ output: { query: 'hello world' } })

    const repaired = await repair({
      system: undefined,
      messages: [],
      toolCall: makeToolCall('unsupported_schema', { query: 42 }),
      tools: { unsupported_schema: { inputSchema: jsonSchema(schemaJson) } } as never,
      inputSchema: async () => schemaJson as never,
      error: inputErr
    })

    expect(repaired).toBeNull()
  })

  it('canonicalizes an empty-parameter repair to an empty object', async () => {
    const emptySchema = z.object({})
    generateText.mockResolvedValue({ output: { arguments: {} } })

    const repaired = await repair({
      system: undefined,
      messages: [],
      toolCall: makeToolCall('empty_tool', undefined),
      tools: { empty_tool: { inputSchema: emptySchema } } as never,
      inputSchema: async () => z.toJSONSchema(emptySchema) as never,
      error: inputErr
    })

    expect(repaired).not.toBeNull()
    expect(JSON.parse(repaired!.input)).toEqual({})
  })

  it('preserves a schema whose canonical input is an arguments field', async () => {
    const argumentsSchema = z.object({ arguments: z.object({ query: z.string() }) })
    const repairArgumentsTool = createAiRepair({
      providerId: 'openai',
      providerSettings: { apiKey: 'test' },
      modelId: 'gpt-4o-mini'
    })
    generateText.mockResolvedValue({ output: { arguments: { query: 'hello world' } } })

    const repaired = await repairArgumentsTool({
      system: undefined,
      messages: [],
      toolCall: makeToolCall('arguments_tool', { query: 'hello world' }),
      tools: { arguments_tool: { inputSchema: argumentsSchema } } as never,
      inputSchema: async () => z.toJSONSchema(argumentsSchema) as never,
      error: inputErr
    })

    expect(repaired).not.toBeNull()
    expect(JSON.parse(repaired!.input)).toEqual({ arguments: { query: 'hello world' } })
  })

  it('reuses the request usage middleware so repair is an independent invocation', async () => {
    const plugins = [{ name: 'usage' }]
    const repairWithUsage = createAiRepair({
      providerId: 'openai',
      providerSettings: { apiKey: 'test' },
      modelId: 'gpt-4o-mini',
      getUsagePlugins: () => plugins as never
    })
    generateText.mockResolvedValue({ output: { query: 'hello world' } })

    const repaired = await repairWithUsage({
      system: undefined,
      messages: [],
      toolCall: makeToolCall(KB_SEARCH_TOOL_NAME, { q: 'hello world' }),
      tools: { [KB_SEARCH_TOOL_NAME]: { inputSchema: querySchema } } as never,
      inputSchema: async () => ({ type: 'object', properties: { query: { type: 'string' } } }) as never,
      error: inputErr
    })

    expect(repaired).not.toBeNull()
    expect(generateText.mock.calls[0][3]).toBe(plugins)
  })

  it('returns null when generateText returns no structured output', async () => {
    generateText.mockResolvedValue({ output: undefined, text: 'sorry, cannot fix' })
    expect(await callRepair(makeToolCall(KB_SEARCH_TOOL_NAME, {}))).toBeNull()
  })

  it('returns null when the structured repair still violates the tool schema', async () => {
    generateText.mockResolvedValue({ output: { arguments: { query: 42 } } })

    expect(await callRepair(makeToolCall(KB_SEARCH_TOOL_NAME, { q: 42 }))).toBeNull()
  })

  it('returns null on non-input errors (NoSuchTool is the model picking a wrong tool name)', async () => {
    expect(await callRepair(makeToolCall(KB_SEARCH_TOOL_NAME, { q: 'hi' }), noSuchToolErr)).toBeNull()
    expect(generateText).not.toHaveBeenCalled()
  })

  it('returns null when the input schema cannot be resolved', async () => {
    const result = await repair({
      system: undefined,
      messages: [],
      toolCall: makeToolCall(KB_SEARCH_TOOL_NAME, { q: 'hi' }),
      tools: {} as never,
      inputSchema: async () => {
        throw new Error('unknown tool')
      },
      error: inputErr
    })
    expect(result).toBeNull()
    expect(generateText).not.toHaveBeenCalled()
  })
})
