import type { LanguageModelV3CallOptions } from '@ai-sdk/provider'
import { describe, expect, it } from 'vitest'

import { createOllamaWithImageModel } from '../../ollama/ollamaProvider'
import { captureWithFetch } from './captureRequest'

const PROMPT: LanguageModelV3CallOptions['prompt'] = [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]

describe('Ollama chat boundary', () => {
  it('converts JSON-string arguments in multi-turn tool history to objects', async () => {
    const prompt: LanguageModelV3CallOptions['prompt'] = [
      { role: 'user', content: [{ type: 'text', text: 'Find and download a book' }] },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call-1',
            toolName: 'search',
            input: '{"query":"The Hobbit"}'
          }
        ]
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call-1',
            toolName: 'search',
            output: { type: 'text', value: 'Found a result' }
          }
        ]
      },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call-2',
            toolName: 'download',
            input: { url: 'https://books.example/hobbit.epub' }
          }
        ]
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call-2',
            toolName: 'download',
            output: { type: 'text', value: 'Downloaded' }
          }
        ]
      }
    ]
    const request = await captureWithFetch((fetch) =>
      createOllamaWithImageModel({ baseURL: 'https://ollama.example/api', fetch })
        .languageModel('qwen3:8b')
        .doGenerate({ prompt })
    )

    expect(request.url).toBe('https://ollama.example/api/chat')
    expect(request.body).toMatchObject({
      messages: [
        {},
        {
          role: 'assistant',
          tool_calls: [
            {
              id: 'call-1',
              function: { name: 'search', arguments: { query: 'The Hobbit' } }
            }
          ]
        },
        { role: 'tool', tool_call_id: 'call-1' },
        {
          role: 'assistant',
          tool_calls: [
            {
              id: 'call-2',
              function: { name: 'download', arguments: { url: 'https://books.example/hobbit.epub' } }
            }
          ]
        },
        { role: 'tool', tool_call_id: 'call-2' }
      ]
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
