import { AnthropicMessagesLanguageModel } from '@ai-sdk/anthropic/internal'
import { describe, expect, it } from 'vitest'

interface CapturedRequest {
  body?: Record<string, unknown>
}

type ThinkingType = 'adaptive' | 'disabled'

interface GenerateOptions {
  thinkingType?: ThinkingType
  maxOutputTokens?: number
  omitMaxOutputTokens?: boolean
}

const createModel = (modelId: string, captured: CapturedRequest): AnthropicMessagesLanguageModel =>
  new AnthropicMessagesLanguageModel(modelId as any, {
    provider: 'test.anthropic',
    baseURL: 'https://example.com',
    headers: () => ({ 'x-api-key': 'test-key' }),
    supportedUrls: () => ({}),
    fetch: async (_url, init) => {
      captured.body = JSON.parse(String(init?.body))

      return new Response(
        JSON.stringify({
          id: 'msg_test',
          type: 'message',
          role: 'assistant',
          model: modelId,
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: {
            input_tokens: 1,
            output_tokens: 1
          }
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' }
        }
      )
    }
  })

const generateWithThinkingAndSampling = async (
  modelId: string,
  { thinkingType = 'adaptive', maxOutputTokens = 128, omitMaxOutputTokens = false }: GenerateOptions = {}
): Promise<CapturedRequest['body']> => {
  const captured: CapturedRequest = {}
  const model = createModel(modelId, captured)

  await model.doGenerate({
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    maxOutputTokens: omitMaxOutputTokens ? undefined : maxOutputTokens,
    temperature: 0.3,
    topK: 40,
    topP: 0.9,
    providerOptions: {
      anthropic: {
        thinking: { type: thinkingType }
      }
    }
  })

  return captured.body
}

describe('@ai-sdk/anthropic compatible thinking patch', () => {
  it('keeps sampling parameters for Anthropic-compatible non-Claude models', async () => {
    const body = await generateWithThinkingAndSampling('MiniMax-M3')

    expect(body).toMatchObject({
      model: 'MiniMax-M3',
      max_tokens: 128,
      temperature: 0.3,
      top_k: 40,
      top_p: 0.9,
      thinking: { type: 'adaptive' }
    })
  })

  it('keeps Claude native sampling guard when thinking is enabled', async () => {
    const body = await generateWithThinkingAndSampling('claude-3-7-sonnet-latest')

    expect(body).toMatchObject({
      model: 'claude-3-7-sonnet-latest',
      max_tokens: 128,
      thinking: { type: 'adaptive' }
    })
    expect(body).not.toHaveProperty('temperature')
    expect(body).not.toHaveProperty('top_k')
    expect(body).not.toHaveProperty('top_p')
  })

  it('passes disabled thinking through for Claude and Anthropic-compatible models', async () => {
    const minimaxBody = await generateWithThinkingAndSampling('MiniMax-M3', { thinkingType: 'disabled' })
    const claudeBody = await generateWithThinkingAndSampling('claude-3-7-sonnet-latest', { thinkingType: 'disabled' })

    expect(minimaxBody).toMatchObject({
      model: 'MiniMax-M3',
      thinking: { type: 'disabled' }
    })
    expect(claudeBody).toMatchObject({
      model: 'claude-3-7-sonnet-latest',
      thinking: { type: 'disabled' }
    })
  })

  it('omits max_tokens for Anthropic-compatible non-Claude models when no limit is provided', async () => {
    const body = await generateWithThinkingAndSampling('MiniMax-M3', { omitMaxOutputTokens: true })

    expect(body).toMatchObject({
      model: 'MiniMax-M3',
      thinking: { type: 'adaptive' }
    })
    expect(body).not.toHaveProperty('max_tokens')
  })
})
