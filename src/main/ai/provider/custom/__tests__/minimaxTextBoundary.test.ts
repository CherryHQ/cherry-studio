import { readFileSync } from 'node:fs'

import { createAnthropic } from '@ai-sdk/anthropic'
import { describe, expect, it, vi } from 'vitest'

import { selectCurrentMiniMaxModels } from '@main/data/services/utils/minimaxModelDiscovery'

import { createMinimaxProvider } from '../minimax/minimaxProvider'

const prompt = [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'hello' }] }]

function chatFetch() {
  return vi.fn().mockImplementation(async () =>
    Response.json({
      id: 'offline',
      model: 'MiniMax-M3.1-Flash',
      created: 1,
      choices: [
        { index: 0, message: { role: 'assistant', content: 'ok', reasoning_content: 'thought' }, finish_reason: 'stop' }
      ],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 }
    })
  )
}

function anthropicFetch() {
  return vi.fn().mockImplementation(async () =>
    Response.json({
      id: 'offline',
      type: 'message',
      role: 'assistant',
      model: 'MiniMax-M3.1-Flash',
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 2 }
    })
  )
}

describe('MiniMax serialized text requests', () => {
  it('serializes the first ordinary direct catalog choice as Flash', async () => {
    const catalog = JSON.parse(readFileSync('packages/provider-registry/data/provider-models.json', 'utf8')) as {
      overrides: { providerId: string; modelId: string; apiModelId: string }[]
    }
    const choices = selectCurrentMiniMaxModels(
      catalog.overrides
        .filter((row) => row.providerId === 'minimax')
        .map((row) => ({ presetModelId: row.modelId, apiModelId: row.apiModelId }))
    )
    const choice = choices.find((model) => model.apiModelId?.startsWith('MiniMax-M'))!
    const fetch = chatFetch()
    const provider = createMinimaxProvider({ apiKey: 'offline-test', fetch })
    await provider.languageModel(choice.apiModelId).doGenerate({ prompt })
    expect(JSON.parse(fetch.mock.calls[0][1].body).model).toBe('MiniMax-M3.1-Flash')
  })

  it.each(['https://api.minimax.io/v1', 'https://api.minimaxi.com/v1'])(
    'keeps default, legacy and custom IDs intact at %s',
    async (baseURL) => {
      const fetch = chatFetch()
      const provider = createMinimaxProvider({ apiKey: 'offline-test', baseURL, fetch })
      for (const modelId of ['MiniMax-M3.1-Flash', 'MiniMax-M3', 'MiniMax-M2.7', 'my-custom-model']) {
        await provider.languageModel(modelId).doGenerate({ prompt })
        const [url, init] = fetch.mock.calls.at(-1)!
        const body = JSON.parse(init.body)
        expect(url).toBe(`${baseURL}/chat/completions`)
        expect(body.model).toBe(modelId)
        expect(body.reasoning_effort).toBeUndefined()
        expect(body.thinking).toBeUndefined()
        expect(body.service_tier).toBeUndefined()
        expect(body.reasoning_split).not.toBe(false)
      }
    }
  )

  it.each(['low', 'medium', 'high', 'xhigh', 'max'])(
    'serializes Flash effort %s through the real OpenAI-compatible SDK',
    async (effort) => {
      const fetch = chatFetch()
      const provider = createMinimaxProvider({ apiKey: 'offline-test', fetch })
      await provider.languageModel('MiniMax-M3.1-Flash').doGenerate({
        prompt,
        providerOptions: { minimax: { reasoningEffort: effort } }
      })
      expect(JSON.parse(fetch.mock.calls[0][1].body).reasoning_effort).toBe(effort)
    }
  )

  it('preserves image, reasoning, tool-call and tool-result history', async () => {
    const fetch = chatFetch()
    const provider = createMinimaxProvider({ apiKey: 'offline-test', fetch })
    const result = await provider.languageModel('MiniMax-M3.1-Flash').doGenerate({
      prompt: [
        {
          role: 'user',
          content: [{ type: 'file', data: new URL('https://example.com/image.png'), mediaType: 'image/png' }]
        },
        {
          role: 'assistant',
          content: [
            { type: 'reasoning', text: 'original thinking' },
            { type: 'tool-call', toolCallId: 'call-1', toolName: 'lookup', input: '{}' }
          ]
        },
        {
          role: 'tool',
          content: [
            { type: 'tool-result', toolCallId: 'call-1', toolName: 'lookup', output: { type: 'text', value: 'result' } }
          ]
        }
      ],
      tools: [{ type: 'function', name: 'lookup', inputSchema: { type: 'object', properties: {} } }]
    })
    const body = JSON.parse(fetch.mock.calls[0][1].body)
    expect(body.messages[0].content[0]).toEqual({
      type: 'image_url',
      image_url: { url: 'https://example.com/image.png' }
    })
    expect(body.messages[1].reasoning_content).toBe('original thinking')
    expect(body.messages[1].tool_calls[0].id).toBe('call-1')
    expect(body.messages[2]).toMatchObject({ role: 'tool', tool_call_id: 'call-1', content: 'result' })
    expect(body.tools[0].function.name).toBe('lookup')
    expect(result.content).toContainEqual({ type: 'reasoning', text: 'thought' })
  })

  it.each(['https://api.minimax.io/anthropic/v1', 'https://api.minimaxi.com/anthropic/v1'])(
    'preserves provider-default thinking on Anthropic at %s',
    async (baseURL) => {
      const fetch = anthropicFetch()
      const provider = createAnthropic({ apiKey: 'offline-test', baseURL, fetch })
      for (const modelId of ['MiniMax-M3.1-Flash', 'MiniMax-M3']) {
        await provider(modelId).doGenerate({ prompt })
        const [url, init] = fetch.mock.calls.at(-1)!
        const body = JSON.parse(init.body)
        expect(url).toBe(`${baseURL}/messages`)
        expect(body.model).toBe(modelId)
        expect(body.thinking).toBeUndefined()
        expect(body.output_config).toBeUndefined()
        expect(body.service_tier).toBeUndefined()
      }
    }
  )

  it.each(['low', 'medium', 'high', 'xhigh', 'max'])(
    'serializes Flash effort %s through the real Anthropic SDK',
    async (effort) => {
      const fetch = anthropicFetch()
      const provider = createAnthropic({
        apiKey: 'offline-test',
        baseURL: 'https://api.minimax.io/anthropic/v1',
        fetch
      })
      await provider('MiniMax-M3.1-Flash').doGenerate({ prompt, providerOptions: { anthropic: { effort } } })
      const body = JSON.parse(fetch.mock.calls[0][1].body)
      expect(body.output_config.effort).toBe(effort)
      expect(body.thinking?.type).not.toBe('disabled')
    }
  )

  it('preserves Anthropic thinking blocks, images and tool history', async () => {
    const fetch = anthropicFetch()
    const provider = createAnthropic({
      apiKey: 'offline-test',
      baseURL: 'https://api.minimaxi.com/anthropic/v1',
      fetch
    })
    await provider('MiniMax-M3.1-Flash').doGenerate({
      prompt: [
        { role: 'user', content: [{ type: 'file', data: new Uint8Array([1, 2, 3]), mediaType: 'image/png' }] },
        {
          role: 'assistant',
          content: [
            {
              type: 'reasoning',
              text: 'original thinking',
              providerOptions: { anthropic: { signature: 'original-signature' } }
            },
            { type: 'tool-call', toolCallId: 'call-1', toolName: 'lookup', input: '{}' }
          ]
        },
        {
          role: 'tool',
          content: [
            { type: 'tool-result', toolCallId: 'call-1', toolName: 'lookup', output: { type: 'text', value: 'result' } }
          ]
        }
      ],
      tools: [{ type: 'function', name: 'lookup', inputSchema: { type: 'object', properties: {} } }]
    })
    const body = JSON.parse(fetch.mock.calls[0][1].body)
    expect(body.messages[0].content[0]).toMatchObject({ type: 'image', source: { type: 'base64', data: 'AQID' } })
    expect(body.messages[1].content[0]).toMatchObject({
      type: 'thinking',
      thinking: 'original thinking',
      signature: 'original-signature'
    })
    expect(body.messages[1].content[1]).toMatchObject({ type: 'tool_use', id: 'call-1' })
    expect(body.messages[2].content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'call-1' })
  })
})
