import type { LanguageModelV3CallOptions } from '@ai-sdk/provider'
import { ENDPOINT_TYPE, MODEL_CAPABILITY } from '@shared/data/types/model'
import { generateText, stepCountIs, tool } from 'ai'
import { describe, expect, it, vi } from 'vitest'
import * as z from 'zod'

import { makeAssistant, makeModel, makeProvider } from '../../../../__tests__/fixtures'
import { buildCapabilityProviderOptions } from '../../../../utils/options'
import { PerplexityAgentLanguageModel } from '../../perplexity/PerplexityAgentLanguageModel'
import { captureWithFetch } from './captureRequest'

const config = (fetch: typeof globalThis.fetch) => ({
  baseURL: 'https://api.perplexity.ai',
  headers: () => ({ Authorization: 'Bearer sk-test' }),
  fetch
})

const prompt = (text: string): LanguageModelV3CallOptions['prompt'] => [
  { role: 'user', content: [{ type: 'text', text }] }
]

describe('Perplexity Agent request boundary', () => {
  it('anthropic model: defaults max_output_tokens and web_search, forwards provider options', async () => {
    const req = await captureWithFetch((fetch) =>
      new PerplexityAgentLanguageModel('anthropic/claude-opus-4-8', config(fetch)).doGenerate({
        prompt: prompt('Q'),
        providerOptions: {
          perplexity: { maxSteps: 3, reasoningEffort: 'high', webSearch: { searchRecencyFilter: 'week' } }
        }
      })
    )

    expect(req.url).toBe('https://api.perplexity.ai/v1/agent')
    z.strictObject({
      model: z.literal('anthropic/claude-opus-4-8'),
      input: z.array(z.strictObject({ type: z.literal('message'), role: z.literal('user'), content: z.literal('Q') })),
      max_output_tokens: z.literal(8192),
      max_steps: z.literal(3),
      reasoning: z.strictObject({ effort: z.literal('high') }),
      tools: z.array(
        z.strictObject({
          type: z.literal('web_search'),
          filters: z.object({ search_recency_filter: z.literal('week') })
        })
      )
    }).parse(req.body)
    expect(req.body).toMatchSnapshot()
  })

  it('non-anthropic model with no options: server tools off, no max_output_tokens', async () => {
    const req = await captureWithFetch((fetch) =>
      new PerplexityAgentLanguageModel('openai/gpt-5.6-sol', config(fetch)).doGenerate({ prompt: prompt('Q') })
    )

    z.strictObject({
      model: z.literal('openai/gpt-5.6-sol'),
      input: z.array(z.strictObject({ type: z.literal('message'), role: z.literal('user'), content: z.literal('Q') }))
    }).parse(req.body)
    expect(req.body).toMatchSnapshot()
  })

  it('serializes server tools together with AI SDK function tools', async () => {
    const req = await captureWithFetch((fetch) =>
      new PerplexityAgentLanguageModel('perplexity/sonar', config(fetch)).doGenerate({
        prompt: prompt('Q'),
        providerOptions: {
          perplexity: {
            webSearch: {
              maxResults: 5,
              searchContextSize: 'high',
              searchDomainFilter: ['-reddit.com'],
              userLocation: { country: 'US' }
            },
            fetchUrl: { maxUrls: 3 }
          }
        },
        tools: [
          {
            type: 'function',
            name: 'save_result',
            description: 'Save a result',
            inputSchema: {
              type: 'object',
              properties: { value: { type: 'string' } },
              required: ['value'],
              additionalProperties: false
            },
            strict: true
          }
        ]
      })
    )

    z.strictObject({
      model: z.literal('perplexity/sonar'),
      input: z.array(z.strictObject({ type: z.literal('message'), role: z.literal('user'), content: z.literal('Q') })),
      tools: z.tuple([
        z.strictObject({
          type: z.literal('web_search'),
          max_results: z.literal(5),
          search_context_size: z.literal('high'),
          filters: z.strictObject({ search_domain_filter: z.array(z.literal('-reddit.com')) }),
          user_location: z.strictObject({ country: z.literal('US') })
        }),
        z.strictObject({ type: z.literal('fetch_url'), max_urls: z.literal(3) }),
        z.strictObject({
          type: z.literal('function'),
          name: z.literal('save_result'),
          description: z.literal('Save a result'),
          parameters: z.object({
            type: z.literal('object'),
            properties: z.object({ value: z.object({ type: z.literal('string') }) }),
            required: z.tuple([z.literal('value')]),
            additionalProperties: z.literal(false)
          }),
          strict: z.literal(true)
        })
      ])
    }).parse(req.body)
    expect(req.body).toMatchSnapshot()
  })

  it('webSearch:false omits the web_search tool entirely', async () => {
    const req = await captureWithFetch((fetch) =>
      new PerplexityAgentLanguageModel('perplexity/sonar', config(fetch)).doGenerate({
        prompt: prompt('Q'),
        providerOptions: { perplexity: { webSearch: false } }
      })
    )
    expect(req.body).not.toHaveProperty('tools')
  })

  it('serializes historical function calls and results with thought signatures', async () => {
    const req = await captureWithFetch((fetch) =>
      new PerplexityAgentLanguageModel('openai/gpt-5.6-sol', config(fetch)).doGenerate({
        prompt: [
          { role: 'user', content: [{ type: 'text', text: 'Q' }] },
          {
            role: 'assistant',
            content: [
              {
                type: 'tool-call',
                toolCallId: 'call-1',
                toolName: 'search',
                input: { q: 'Q' },
                providerOptions: { perplexity: { itemId: 'fc-1', thoughtSignature: 'sig-1' } }
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
                output: { type: 'text', value: 'result' }
              }
            ]
          },
          { role: 'user', content: [{ type: 'text', text: 'Continue' }] }
        ]
      })
    )

    expect(req.body).toMatchObject({
      input: [
        { type: 'message', role: 'user', content: 'Q' },
        {
          type: 'function_call',
          call_id: 'call-1',
          name: 'search',
          arguments: '{"q":"Q"}',
          thought_signature: 'sig-1'
        },
        {
          type: 'function_call_output',
          call_id: 'call-1',
          name: 'search',
          output: 'result',
          thought_signature: 'sig-1'
        },
        { type: 'message', role: 'user', content: 'Continue' }
      ]
    })
  })

  it('toolChoice:none suppresses both server and function tools', async () => {
    const req = await captureWithFetch((fetch) =>
      new PerplexityAgentLanguageModel('openai/gpt-5.6-sol', config(fetch)).doGenerate({
        prompt: prompt('Q'),
        providerOptions: { perplexity: { webSearch: true } },
        tools: [{ type: 'function', name: 'lookup', inputSchema: { type: 'object', properties: {} } }],
        toolChoice: { type: 'none' }
      })
    )

    expect(req.body).not.toHaveProperty('tools')
  })

  it('runs a complete AI SDK function-call loop and sends the result back to Agent API', async () => {
    const bodies: Array<Record<string, unknown>> = []
    const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      const response =
        bodies.length === 1
          ? {
              id: 'r1',
              status: 'completed',
              model: 'openai/gpt-5.6-sol',
              output: [
                {
                  type: 'function_call',
                  id: 'fc-1',
                  status: 'completed',
                  name: 'lookup_order',
                  call_id: 'call-1',
                  arguments: '{"orderId":"ORD-1"}',
                  thought_signature: 'sig-1'
                }
              ]
            }
          : {
              id: 'r2',
              status: 'completed',
              model: 'openai/gpt-5.6-sol',
              output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Shipped' }] }]
            }
      return new Response(JSON.stringify(response), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as typeof globalThis.fetch
    const execute = vi.fn(async ({ orderId }: { orderId: string }) => ({ orderId, status: 'shipped' }))

    const result = await generateText({
      model: new PerplexityAgentLanguageModel('openai/gpt-5.6-sol', config(fetch)),
      prompt: 'Where is ORD-1?',
      tools: {
        lookup_order: tool({
          description: 'Look up an order',
          inputSchema: z.object({ orderId: z.string() }),
          execute
        })
      },
      stopWhen: stepCountIs(2)
    })

    expect(result.text).toBe('Shipped')
    expect(execute).toHaveBeenCalledWith({ orderId: 'ORD-1' }, expect.anything())
    expect(bodies).toHaveLength(2)
    expect(bodies[1].input).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'function_call',
          call_id: 'call-1',
          name: 'lookup_order',
          thought_signature: 'sig-1'
        }),
        expect.objectContaining({
          type: 'function_call_output',
          call_id: 'call-1',
          name: 'lookup_order',
          output: '{"orderId":"ORD-1","status":"shipped"}',
          thought_signature: 'sig-1'
        })
      ])
    )
  })

  it.each([
    ['none', undefined],
    ['xhigh', { effort: 'xhigh' }]
  ] as const)('normalizes assistant reasoning effort %s at the final request boundary', async (effort, expected) => {
    const provider = makeProvider({
      id: 'perplexity',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {
          adapterFamily: 'perplexity',
          baseUrl: 'https://api.perplexity.ai'
        }
      }
    })
    const model = makeModel({
      id: 'perplexity::gpt-5-6-sol',
      providerId: 'perplexity',
      apiModelId: 'openai/gpt-5.6-sol',
      capabilities: [MODEL_CAPABILITY.REASONING],
      reasoning: { type: 'perplexity', supportedEfforts: ['none', 'low', 'medium', 'high', 'max'] }
    })
    const assistant = makeAssistant({ settings: { reasoning_effort: effort } })
    const providerOptions = buildCapabilityProviderOptions(assistant, model, provider, {
      enableReasoning: true,
      enableWebSearch: false,
      enableGenerateImage: false
    })

    const req = await captureWithFetch((fetch) =>
      new PerplexityAgentLanguageModel('openai/gpt-5.6-sol', config(fetch)).doGenerate({
        prompt: prompt('Q'),
        providerOptions
      })
    )

    if (expected) expect(req.body).toHaveProperty('reasoning', expected)
    else expect(req.body).not.toHaveProperty('reasoning')
  })

  it('routes a URL-referenced PDF to file_url, not file_data', async () => {
    const req = await captureWithFetch((fetch) =>
      new PerplexityAgentLanguageModel('perplexity/sonar', config(fetch)).doGenerate({
        prompt: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Summarize' },
              { type: 'file', mediaType: 'application/pdf', data: new URL('https://x.com/doc.pdf') }
            ]
          }
        ]
      })
    )
    const input = (req.body as { input: Array<{ content: Array<{ type: string }> }> }).input
    const fileParts = input[0].content.filter((c) => c.type === 'input_file')
    expect(fileParts).toEqual([{ type: 'input_file', file_url: 'https://x.com/doc.pdf' }])
  })

  it('omits response_format when JSON mode has no schema', async () => {
    const req = await captureWithFetch((fetch) =>
      new PerplexityAgentLanguageModel('perplexity/sonar', config(fetch)).doGenerate({
        prompt: prompt('Q'),
        responseFormat: { type: 'json' }
      })
    )
    expect(req.body).not.toHaveProperty('response_format')
  })
})
