import type { JSONObject, LanguageModelV3CallOptions } from '@ai-sdk/provider'
import { describe, expect, it } from 'vitest'

import { REASONING_FORMAT_PROFILES } from '@cherrystudio/provider-registry'
import { encodeReasoningInvocation, resolveReasoningInvocation } from '@main/ai/utils/reasoningSerializers'

import { makeModel } from '../../../../__tests__/fixtures/model'
import { createOllamaWithImageModel } from '../../ollama/ollamaProvider'
import { captureWithFetch } from './captureRequest'

const PROMPT: LanguageModelV3CallOptions['prompt'] = [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]

describe('Ollama chat reasoning boundary', () => {
  const model = makeModel({
    id: 'ollama::qwen3.8:27b',
    providerId: 'ollama',
    reasoning: {
      controls: [{ kind: 'effort', values: ['none', 'low', 'medium', 'xhigh'] }],
      selectableEfforts: ['none', 'low', 'medium', 'xhigh'],
      defaultEffort: 'medium'
    }
  })

  describe.each(['doGenerate', 'doStream'] as const)('%s', (method) => {
    it.each([
      ['default', undefined],
      ['none', false],
      ['low', 'low'],
      ['medium', 'medium'],
      ['xhigh', 'xhigh']
    ] as const)('sends the selected %s effort through the SDK', async (selection, expected) => {
      const invocation = resolveReasoningInvocation({
        selection,
        model,
        profile: REASONING_FORMAT_PROFILES.ollama.wire
      })
      const request = await captureWithFetch((fetch) =>
        createOllamaWithImageModel({ baseURL: 'https://ollama.example/api', fetch })
          .languageModel('qwen3.8:27b')
          [method]({
            prompt: PROMPT,
            providerOptions: { ollama: encodeReasoningInvocation(invocation) as JSONObject }
          })
      )

      expect(request.url).toBe('https://ollama.example/api/chat')
      expect(request.body).toMatchObject({ model: 'qwen3.8:27b', stream: method === 'doStream' })
      if (expected === undefined) expect(request.body).not.toHaveProperty('think')
      else expect(request.body).toHaveProperty('think', expected)
    })
  })
  it('leaves thinking unset when no reasoning option is selected', async () => {
    const request = await captureWithFetch((fetch) =>
      createOllamaWithImageModel({ baseURL: 'https://ollama.example/api', fetch })
        .languageModel('qwen3:8b')
        .doGenerate({ prompt: PROMPT })
    )

    expect(request.url).toBe('https://ollama.example/api/chat')
    expect(request.body).not.toHaveProperty('think')
  })

  it('sends think false when thinking is explicitly disabled', async () => {
    const request = await captureWithFetch((fetch) =>
      createOllamaWithImageModel({ baseURL: 'https://ollama.example/api', fetch })
        .languageModel('qwen3:8b')
        .doGenerate({
          prompt: PROMPT,
          providerOptions: { ollama: { think: false } }
        })
    )

    expect(request.body).toHaveProperty('think', false)
  })
})
