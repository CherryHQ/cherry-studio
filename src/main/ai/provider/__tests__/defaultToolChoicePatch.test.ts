import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { ToolChoice, ToolSet } from 'ai'
import { generateText, jsonSchema, streamText, tool } from 'ai'
import { describe, expect, it } from 'vitest'

import { createCustomParamsFetch } from '../../runtime/aiSdk/params/customParamsFetch'

async function send({
  streaming = false,
  adapter = 'compatible',
  customParams = {},
  toolChoice,
  stepToolChoice
}: {
  streaming?: boolean
  adapter?: 'compatible' | 'openai'
  customParams?: Record<string, unknown>
  toolChoice?: ToolChoice<ToolSet>
  stepToolChoice?: ToolChoice<ToolSet>
} = {}) {
  let body: Record<string, unknown> = {}
  const fetch: typeof globalThis.fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body))
    const completion = { id: 'reply', model: 'test-model', created: 1 }
    return streaming
      ? new Response(
          `data: ${JSON.stringify({ ...completion, choices: [{ index: 0, delta: { content: 'OK' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
          { headers: { 'content-type': 'text/event-stream' } }
        )
      : new Response(
          JSON.stringify({
            ...completion,
            choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }]
          }),
          { headers: { 'content-type': 'application/json' } }
        )
  }
  const providerSettings = {
    apiKey: 'test-key',
    name: 'test-provider',
    baseURL: 'https://provider.example/v1',
    fetch: createCustomParamsFetch(fetch, customParams)
  }
  const model =
    adapter === 'openai'
      ? createOpenAI(providerSettings).chat('test-model')
      : createOpenAICompatible(providerSettings).chatModel('test-model')
  const tools: ToolSet = { lookup: tool({ inputSchema: jsonSchema({ type: 'object', properties: {} }) }) }
  const options = {
    model,
    prompt: 'Say OK.',
    tools,
    toolChoice,
    ...(stepToolChoice && { prepareStep: () => ({ toolChoice: stepToolChoice }) }),
    maxRetries: 0
  }
  const result = streaming ? streamText(options) : await generateText(options)
  expect(await result.text).toBe('OK')
  return body
}

describe('default tool choice on the HTTP wire', () => {
  it.each([false, true])('omits the SDK default while retaining tools (streaming=%s)', async (streaming) => {
    const body = await send({ streaming })
    expect(body).not.toHaveProperty('tool_choice')
    expect(body.tools).toMatchObject([{ type: 'function', function: { name: 'lookup' } }])
  })

  it('also omits the default on the OpenAI Chat adapter', async () => {
    expect(await send({ adapter: 'openai' })).not.toHaveProperty('tool_choice')
  })

  it.each(['auto', 'none', 'required', { type: 'auto' }])('preserves user custom tool_choice=%j', async (choice) => {
    expect(await send({ customParams: { tool_choice: choice } })).toHaveProperty('tool_choice', choice)
  })

  it.each(['auto', 'none', 'required'] as const)('preserves explicit SDK policy %s', async (toolChoice) => {
    expect(await send({ toolChoice })).toHaveProperty('tool_choice', toolChoice)
  })

  it('preserves a forced tool and its precedence over custom parameters', async () => {
    const body = await send({
      toolChoice: { type: 'tool', toolName: 'lookup' },
      customParams: { tool_choice: 'none' }
    })
    expect(body.tool_choice).toEqual({ type: 'function', function: { name: 'lookup' } })
  })

  it.each(['auto', 'none', 'required'] as const)('preserves a per-step policy %s', async (stepToolChoice) => {
    expect(await send({ stepToolChoice })).toHaveProperty('tool_choice', stepToolChoice)
  })
})

async function captureNativeRequest(adapter: 'anthropic' | 'google' | 'responses', restricted = false) {
  let body: Record<string, unknown> = {}
  const captured = new Error('Request captured')
  const settings = {
    apiKey: 'test-key',
    fetch: async (_input: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body))
      throw captured
    }
  }
  const model =
    adapter === 'anthropic'
      ? createAnthropic(settings)('claude-sonnet-4-5')
      : adapter === 'google'
        ? createGoogleGenerativeAI(settings)('gemini-2.5-flash')
        : createOpenAI(settings).responses('gpt-4.1')

  await expect(
    generateText({
      model,
      prompt: 'Look up the answer.',
      tools: {
        lookup: tool({ inputSchema: jsonSchema({ type: 'object', properties: {} }), strict: restricted })
      },
      ...(restricted && { providerOptions: { anthropic: { disableParallelToolUse: true } } }),
      maxRetries: 0
    })
  ).rejects.toThrow(captured.message)
  return body
}

describe('native adapters retain their own defaults and constraints', () => {
  it.each(['anthropic', 'responses', 'google'] as const)('omits an unconfigured choice on %s', async (adapter) => {
    const body = await captureNativeRequest(adapter)
    expect(body).not.toHaveProperty('tool_choice')
    expect(body).not.toHaveProperty('toolConfig')
    expect(body.tools).toBeInstanceOf(Array)
    expect(body.tools).not.toHaveLength(0)
  })

  it('retains the Anthropic parallel-tool restriction', async () => {
    expect((await captureNativeRequest('anthropic', true)).tool_choice).toEqual({
      type: 'auto',
      disable_parallel_tool_use: true
    })
  })

  it('retains Gemini strict tool validation', async () => {
    expect((await captureNativeRequest('google', true)).toolConfig).toEqual({
      functionCallingConfig: { mode: 'VALIDATED' }
    })
  })
})
