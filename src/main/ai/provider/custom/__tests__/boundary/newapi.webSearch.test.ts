import type { LanguageModelV3CallOptions } from '@ai-sdk/provider'
import { describe, expect, it } from 'vitest'

import { createNewApi } from '../../newapiProvider'
import { captureWithFetch, runWithResponse } from './captureRequest'

const prompt: LanguageModelV3CallOptions['prompt'] = [
  { role: 'user', content: [{ type: 'text', text: 'What happened today?' }] }
]

function createModel(fetch: typeof globalThis.fetch) {
  return createNewApi({
    apiKey: 'sk',
    baseURL: 'https://example.com/v1',
    endpointType: 'openai',
    fetch
  }).languageModel('gemini-2.5-pro')
}

describe('New API Gemini web search boundary', () => {
  it('passes web_search_options through the compatible chat request', async () => {
    const request = await captureWithFetch((fetch) =>
      createModel(fetch).doGenerate({
        prompt,
        providerOptions: { newapi: { web_search_options: {} } }
      })
    )

    expect(request.body).toMatchObject({ web_search_options: {} })
  })

  it('converts OpenAI-compatible URL citations to sources', async () => {
    const response = {
      id: 'chatcmpl-1',
      created: 1,
      model: 'gemini-2.5-pro',
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'Current information.',
            annotations: [
              {
                type: 'url_citation',
                url_citation: {
                  start_index: 0,
                  end_index: 20,
                  url: 'https://example.com/source',
                  title: 'Example source'
                }
              }
            ]
          },
          finish_reason: 'stop'
        }
      ],
      usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 }
    }

    const result = await runWithResponse(response, (fetch) => createModel(fetch).doGenerate({ prompt }))

    expect(result.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'source',
          sourceType: 'url',
          url: 'https://example.com/source',
          title: 'Example source'
        })
      ])
    )
  })

  it('ignores unknown annotations without rejecting a non-streaming answer', async () => {
    const response = {
      id: 'chatcmpl-mixed',
      created: 1,
      model: 'gemini-2.5-pro',
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'Answer with a file annotation.',
            annotations: [
              { type: 'file_citation', file_citation: { file_id: 'file-1', quote: 'supporting text' } },
              { type: 'custom_annotation', payload: { vendor: 'openrouter' } }
            ]
          },
          finish_reason: 'stop'
        }
      ],
      usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 }
    }

    const result = await runWithResponse(response, (fetch) => createModel(fetch).doGenerate({ prompt }))

    expect(result.content).toEqual([{ type: 'text', text: 'Answer with a file annotation.' }])
  })

  it('omits a non-string URL citation title', async () => {
    const response = {
      id: 'chatcmpl-invalid-title',
      created: 1,
      model: 'gemini-2.5-pro',
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'Answer with an untrusted title.',
            annotations: [
              {
                type: 'url_citation',
                url_citation: {
                  url: 'https://example.com/untrusted-title',
                  title: { label: 'not a string' }
                }
              }
            ]
          },
          finish_reason: 'stop'
        }
      ],
      usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 }
    }

    const result = await runWithResponse(response, (fetch) => createModel(fetch).doGenerate({ prompt }))

    expect(result.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'source',
          sourceType: 'url',
          url: 'https://example.com/untrusted-title',
          title: undefined
        })
      ])
    )
  })

  it('converts streamed URL citation annotations to source parts', async () => {
    const annotation = {
      type: 'url_citation',
      url_citation: {
        start_index: 0,
        end_index: 20,
        url: 'https://example.com/live-source',
        title: 'Live source'
      }
    }
    const body = [
      `data: ${JSON.stringify({
        id: 'chatcmpl-2',
        created: 1,
        model: 'gemini-2.5-pro',
        choices: [
          {
            delta: { role: 'assistant', content: 'Current information.', annotations: [annotation] },
            finish_reason: 'stop'
          }
        ],
        usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 }
      })}`,
      'data: [DONE]',
      ''
    ].join('\n\n')
    const fetch = (() =>
      Promise.resolve(
        new Response(body, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' }
        })
      )) as typeof globalThis.fetch

    const result = await createModel(fetch).doStream({ prompt })
    const parts = await Array.fromAsync(result.stream)

    expect(parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'source',
          sourceType: 'url',
          url: 'https://example.com/live-source',
          title: 'Live source'
        })
      ])
    )
  })

  it('ignores unknown streamed annotations without emitting an error', async () => {
    const body = [
      `data: ${JSON.stringify({
        id: 'chatcmpl-mixed-stream',
        created: 1,
        model: 'gemini-2.5-pro',
        choices: [
          {
            delta: {
              role: 'assistant',
              content: 'Streaming answer.',
              annotations: [{ type: 'file_citation', file_citation: { file_id: 'file-1' } }]
            },
            finish_reason: 'stop'
          }
        ],
        usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 }
      })}`,
      'data: [DONE]',
      ''
    ].join('\n\n')
    const fetch = (() =>
      Promise.resolve(
        new Response(body, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' }
        })
      )) as typeof globalThis.fetch

    const result = await createModel(fetch).doStream({ prompt })
    const parts = await Array.fromAsync(result.stream)

    expect(parts).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'text-delta', delta: 'Streaming answer.' })])
    )
    expect(parts).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: 'error' })]))
  })

  it('omits a non-string streamed URL citation title', async () => {
    const body = [
      `data: ${JSON.stringify({
        id: 'chatcmpl-invalid-stream-title',
        created: 1,
        model: 'gemini-2.5-pro',
        choices: [
          {
            delta: {
              role: 'assistant',
              content: 'Streaming answer.',
              annotations: [
                {
                  type: 'url_citation',
                  url_citation: {
                    url: 'https://example.com/untrusted-stream-title',
                    title: { label: 'not a string' }
                  }
                }
              ]
            },
            finish_reason: 'stop'
          }
        ],
        usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 }
      })}`,
      'data: [DONE]',
      ''
    ].join('\n\n')
    const fetch = (() =>
      Promise.resolve(
        new Response(body, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' }
        })
      )) as typeof globalThis.fetch

    const result = await createModel(fetch).doStream({ prompt })
    const parts = await Array.fromAsync(result.stream)

    expect(parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'source',
          sourceType: 'url',
          url: 'https://example.com/untrusted-stream-title',
          title: undefined
        })
      ])
    )
  })
})
