import { describe, expect, it } from 'vitest'

import { createAihubmix } from '../aihubmix/aihubmixProvider'
import { captureWithFetch } from './boundary/captureRequest'

describe('AiHubMix execution binding', () => {
  it('rejects chat without a selected client instead of guessing from the model name', () => {
    expect(() => createAihubmix({ apiKey: 'sk' }).languageModel('claude-sonnet-4-5')).toThrow(
      'explicit supported endpoint'
    )
  })

  it('uses compatible Chat for a Claude id when explicitly bound to Chat', async () => {
    const request = await captureWithFetch((fetch) =>
      createAihubmix({
        apiKey: 'sk',
        fetch,
        endpointType: 'openai-chat-completions'
      })
        .languageModel('claude-sonnet-4-5')
        .doGenerate({
          prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
          providerOptions: { aihubmix: { reasoningEffort: 'high' } }
        })
    )
    expect(request.url).toBe('https://aihubmix.com/v1/chat/completions')
    expect(request.body).toMatchObject({ model: 'claude-sonnet-4-5', reasoning_effort: 'high' })
  })
})
