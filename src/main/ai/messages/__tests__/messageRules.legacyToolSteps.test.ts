import { createOpenAI } from '@ai-sdk/openai'
import { type DynamicToolUIPart, generateText, type ModelMessage, type UIMessage } from 'ai'
import { describe, expect, it } from 'vitest'

import { toModelMessages } from '../messageRules'

const completedTool = (toolCallId: string): DynamicToolUIPart => ({
  type: 'dynamic-tool',
  toolName: 'lookup',
  toolCallId,
  state: 'output-available',
  input: { query: toolCallId },
  output: { result: toolCallId }
})

const failedTool = (toolCallId: string): DynamicToolUIPart => ({
  type: 'dynamic-tool',
  toolName: 'lookup',
  toolCallId,
  state: 'output-error',
  input: { query: toolCallId },
  errorText: 'lookup failed'
})

const assistant = (parts: UIMessage['parts'], id = 'assistant'): UIMessage => ({ id, role: 'assistant', parts })

const partTypes = (message: ModelMessage) =>
  Array.isArray(message.content) ? message.content.map((part) => part.type) : []

describe('legacy tool step replay', () => {
  it('keeps parallel tool outputs ahead of the following assistant text (#19465)', async () => {
    const model = await toModelMessages([
      assistant([
        { type: 'text', text: 'Before tools' },
        completedTool('call-1'),
        failedTool('call-2'),
        { type: 'text', text: 'After tools' }
      ])
    ])

    expect(model.map((message) => message.role)).toEqual(['assistant', 'tool', 'assistant'])
    expect(partTypes(model[0])).toEqual(['text', 'tool-call', 'tool-call'])
    expect(partTypes(model[1])).toEqual(['tool-result', 'tool-result'])
    expect(model[2]).toEqual({ role: 'assistant', content: [{ type: 'text', text: 'After tools' }] })
  })

  it('serializes Responses tool outputs before the next assistant item', async () => {
    const prompt = await toModelMessages([
      assistant([
        { type: 'text', text: 'Before tools' },
        completedTool('call-1'),
        completedTool('call-2'),
        { type: 'text', text: 'After tools' }
      ])
    ])
    let requestBody: { input?: Array<{ role?: string; type?: string }> } = {}
    const model = createOpenAI({
      apiKey: 'test-key',
      baseURL: 'https://example.com/v1',
      fetch: async (_input, init) => {
        requestBody = JSON.parse(String(init?.body))
        return new Response(
          JSON.stringify({
            id: 'resp_1',
            created_at: 1,
            model: 'deepseek-v4-pro',
            status: 'completed',
            output: [],
            usage: { input_tokens: 1, output_tokens: 1 }
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      }
    }).responses('deepseek-v4-pro')

    await generateText({ model, messages: prompt })

    expect(requestBody.input?.map((item) => (item.type === 'message' ? item.role : item.type))).toEqual([
      'assistant',
      'function_call',
      'function_call',
      'function_call_output',
      'function_call_output',
      'assistant'
    ])
  })

  it('restores every inferable boundary in a multi-step legacy message', async () => {
    const model = await toModelMessages([
      assistant([
        { type: 'text', text: 'Step 1' },
        completedTool('call-1'),
        { type: 'text', text: 'Step 2' },
        completedTool('call-2'),
        { type: 'text', text: 'Done' }
      ])
    ])

    expect(model.map((message) => message.role)).toEqual(['assistant', 'tool', 'assistant', 'tool', 'assistant'])
    expect(partTypes(model[0])).toEqual(['text', 'tool-call'])
    expect(partTypes(model[1])).toEqual(['tool-result'])
    expect(partTypes(model[2])).toEqual(['text', 'tool-call'])
    expect(partTypes(model[3])).toEqual(['tool-result'])
    expect(model[4]).toEqual({ role: 'assistant', content: [{ type: 'text', text: 'Done' }] })
  })

  it('preserves explicit step boundaries in current messages', async () => {
    const model = await toModelMessages([
      assistant([
        { type: 'step-start' },
        { type: 'text', text: 'Before tools' },
        completedTool('call-1'),
        { type: 'step-start' },
        { type: 'text', text: 'After tools' }
      ])
    ])

    expect(model.map((message) => message.role)).toEqual(['assistant', 'tool', 'assistant'])
    expect(partTypes(model[0])).toEqual(['text', 'tool-call'])
    expect(partTypes(model[1])).toEqual(['tool-result'])
    expect(model[2]).toEqual({ role: 'assistant', content: [{ type: 'text', text: 'After tools' }] })
  })

  it('restores a boundary after a denied local tool', async () => {
    const model = await toModelMessages([
      assistant([
        {
          type: 'dynamic-tool',
          toolName: 'lookup',
          toolCallId: 'call-denied',
          state: 'output-denied',
          input: {},
          approval: { id: 'approval-1', approved: false, reason: 'Not allowed' }
        },
        { type: 'text', text: 'Alternative' }
      ])
    ])

    expect(model.map((message) => message.role)).toEqual(['assistant', 'tool', 'assistant'])
    expect(model[2]).toEqual({ role: 'assistant', content: [{ type: 'text', text: 'Alternative' }] })
  })

  it('does not split provider-executed or incomplete tools', async () => {
    const providerTool = await toModelMessages([
      assistant([
        { ...completedTool('provider-call'), providerExecuted: true },
        { type: 'text', text: 'Same provider step' }
      ])
    ])
    const incompleteTool = await toModelMessages([
      assistant([
        {
          type: 'dynamic-tool',
          toolName: 'lookup',
          toolCallId: 'pending-call',
          state: 'input-available',
          input: {}
        },
        { type: 'text', text: 'Still here' }
      ])
    ])

    expect(providerTool.map((message) => message.role)).toEqual(['assistant'])
    expect(partTypes(providerTool[0])).toEqual(['tool-call', 'tool-result', 'text'])
    expect(incompleteTool).toEqual([{ role: 'assistant', content: [{ type: 'text', text: 'Still here' }] }])
  })
})
