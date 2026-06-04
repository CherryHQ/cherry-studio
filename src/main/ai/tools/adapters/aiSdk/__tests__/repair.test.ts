import type { LanguageModelV3ToolCall } from '@ai-sdk/provider'
import { KB_SEARCH_TOOL_NAME } from '@shared/ai/builtinTools'
import { InvalidToolInputError, NoSuchToolError } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
    tools: {} as never,
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

  it('returns null when generateText returns no structured output', async () => {
    generateText.mockResolvedValue({ output: undefined, text: 'sorry, cannot fix' })
    expect(await callRepair(makeToolCall(KB_SEARCH_TOOL_NAME, {}))).toBeNull()
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
