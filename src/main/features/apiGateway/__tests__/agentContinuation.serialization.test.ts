import type { MessageCreateParams } from '@anthropic-ai/sdk/resources/messages'
import { generateText } from 'ai'
import { describe, expect, it } from 'vitest'

import { createCherryIn } from '@cherrystudio/ai-sdk-provider'
import { toModelMessages } from '@main/ai/messages/messageRules'

import { AnthropicMessageConverter } from '../adapters/converters/AnthropicMessageConverter'
import { AGENT_CONTINUATION_TEXT, appendInternalAgentContinuation } from '../utils/agentContinuation'

const params = (overrides: Partial<MessageCreateParams>): MessageCreateParams => ({
  model: 'anthropic:claude',
  max_tokens: 1024,
  messages: [],
  ...overrides
})

const thinking = { type: 'thinking', thinking: 'Thinking', signature: '' } as const
const text = { type: 'text', text: 'Working' } as const
const toolUse = { type: 'tool_use', id: 'call_1', name: 'get_weather', input: { city: 'SF' } } as const

type AssistantContent = Exclude<MessageCreateParams['messages'][number]['content'], string>
type GeminiContent = { role: string; parts: unknown[] }

async function serialize(input: MessageCreateParams, internal = true) {
  const converter = new AnthropicMessageConverter()
  const converted = converter.toUIMessages(input)
  const messages = internal ? appendInternalAgentContinuation(converted) : converted
  const tools = converter.toAiSdkTools(input)
  const prompt = await toModelMessages(messages, undefined, tools)
  let requestBody: { contents: GeminiContent[] } = { contents: [] }
  const model = createCherryIn({
    apiKey: 'test-key',
    endpointType: 'gemini',
    geminiBaseURL: 'https://capture.example/v1beta',
    fetch: async (_input, init) => {
      requestBody = JSON.parse(String(init?.body))
      return new Response(
        JSON.stringify({
          candidates: [{ content: { role: 'model', parts: [{ text: 'Done' }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 }
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    }
  }).languageModel('gemini-flash-lite-latest')

  await generateText({ model, messages: prompt, tools, ...converter.extractStreamOptions(input), maxRetries: 0 })

  return { contents: requestBody.contents, prompt }
}

function fixture(content: AssistantContent, shell = false): MessageCreateParams {
  return params({
    messages: [
      { role: 'user', content: 'Continue task' },
      { role: 'assistant', content },
      ...(shell ? [{ role: 'user' as const, content: '' }] : [])
    ]
  })
}

describe('internal Agent continuation Gemini serialization', () => {
  it.each([
    {
      label: 'reported thinking + text with empty user shell',
      content: [thinking, text],
      shell: true,
      expectedParts: [{ text: 'Thinking', thought: true }, { text: 'Working' }]
    },
    {
      label: 'thinking + text without shell',
      content: [thinking, text],
      shell: false,
      expectedParts: [{ text: 'Thinking', thought: true }, { text: 'Working' }]
    },
    { label: 'thinking only', content: [thinking], shell: false, expectedParts: [{ text: 'Thinking', thought: true }] },
    {
      label: 'redacted thinking + text',
      content: [{ type: 'redacted_thinking', data: 'opaque' }, text],
      shell: false,
      expectedParts: [{ text: 'Working' }]
    },
    { label: 'text-only with empty user shell', content: [text], shell: true, expectedParts: [{ text: 'Working' }] },
    { label: 'text-only without shell', content: [text], shell: false, expectedParts: [{ text: 'Working' }] }
  ] satisfies Array<{ label: string; content: AssistantContent; shell: boolean; expectedParts: unknown[] }>)(
    'serializes $label with exactly one user continuation',
    async ({ content, shell, expectedParts }) => {
      const { contents } = await serialize(fixture(content, shell))

      expect(contents.map((entry) => entry.role)).toEqual(['user', 'model', 'user'])
      expect(contents).toEqual([
        { role: 'user', parts: [{ text: 'Continue task' }] },
        { role: 'model', parts: expectedParts },
        { role: 'user', parts: [{ text: AGENT_CONTINUATION_TEXT }] }
      ])
    }
  )

  it('leaves pending-tool-only history without a continuation after product filtering', async () => {
    const { contents } = await serialize(fixture([toolUse]))

    expect(contents.map((entry) => entry.role)).toEqual(['user'])
    expect(contents).toEqual([{ role: 'user', parts: [{ text: 'Continue task' }] }])
  })

  it.each([
    { label: 'text', content: [text, toolUse], expectedParts: [{ text: 'Working' }] },
    { label: 'reasoning', content: [thinking, toolUse], expectedParts: [{ text: 'Thinking', thought: true }] },
    {
      label: 'reasoning + text',
      content: [thinking, text, toolUse],
      expectedParts: [{ text: 'Thinking', thought: true }, { text: 'Working' }]
    }
  ] satisfies Array<{ label: string; content: AssistantContent; expectedParts: unknown[] }>)(
    'leaves pending tools with $label without a continuation',
    async ({ content, expectedParts }) => {
      const { contents } = await serialize(fixture(content))

      expect(contents.map((entry) => entry.role)).toEqual(['user', 'model'])
      expect(contents).toEqual([
        { role: 'user', parts: [{ text: 'Continue task' }] },
        { role: 'model', parts: expectedParts }
      ])
    }
  )

  it('preserves a completed local tool call and its final user result without a continuation', async () => {
    const { contents, prompt } = await serialize(
      params({
        tools: [{ name: 'get_weather', input_schema: { type: 'object', properties: { city: { type: 'string' } } } }],
        messages: [
          { role: 'user', content: 'Continue task' },
          { role: 'assistant', content: [toolUse] },
          { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: '72F' }] }
        ]
      })
    )

    expect(prompt).toMatchObject([
      { role: 'user' },
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: 'call_1', toolName: 'get_weather', input: { city: 'SF' } }]
      },
      {
        role: 'tool',
        content: [
          { type: 'tool-result', toolCallId: 'call_1', toolName: 'get_weather', output: { type: 'text', value: '72F' } }
        ]
      }
    ])
    expect(contents.map((entry) => entry.role)).toEqual(['user', 'model', 'user'])
    expect(contents).toMatchObject([
      { role: 'user', parts: [{ text: 'Continue task' }] },
      { role: 'model', parts: [{ functionCall: { name: 'get_weather', args: { city: 'SF' } } }] },
      {
        role: 'user',
        parts: [{ functionResponse: { name: 'get_weather', response: { name: 'get_weather', content: '72F' } } }]
      }
    ])
  })

  // Omitting normalization models external wire behavior; credential classification is covered by gateway wiring tests.
  it('preserves an unnormalized external mixed assistant tail', async () => {
    const { contents } = await serialize(fixture([thinking, text]), false)

    expect(contents.map((entry) => entry.role)).toEqual(['user', 'model'])
    expect(contents).toEqual([
      { role: 'user', parts: [{ text: 'Continue task' }] },
      { role: 'model', parts: [{ text: 'Thinking', thought: true }, { text: 'Working' }] }
    ])
  })
})
