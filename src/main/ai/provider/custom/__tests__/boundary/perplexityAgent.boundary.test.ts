import type { LanguageModelV3CallOptions } from '@ai-sdk/provider'
import { ENDPOINT_TYPE, MODEL_CAPABILITY } from '@shared/data/types/model'
import { generateText, stepCountIs, tool } from 'ai'
import { describe, expect, it, vi } from 'vitest'
import * as z from 'zod'

import { makeAssistant, makeModel, makeProvider } from '../../../../__tests__/fixtures'
import { buildCapabilityProviderOptions } from '../../../../utils/options'
import { PerplexityAgentLanguageModel } from '../../perplexity/PerplexityAgentLanguageModel'
import { perplexityTools } from '../../perplexity/perplexityTools'
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
  it('anthropic model: defaults max_output_tokens and forwards provider options with a web-search tool', async () => {
    const req = await captureWithFetch((fetch) =>
      new PerplexityAgentLanguageModel('anthropic/claude-opus-4-8', config(fetch)).doGenerate({
        prompt: prompt('Q'),
        providerOptions: {
          perplexity: { maxSteps: 3, reasoningEffort: 'high' }
        },
        tools: [
          {
            type: 'provider',
            name: 'webSearch',
            id: 'perplexity.web_search',
            args: { searchRecencyFilter: 'week' }
          }
        ]
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
        tools: [
          {
            type: 'provider',
            name: 'webSearch',
            id: 'perplexity.web_search',
            args: {
              maxResults: 5,
              searchContextSize: 'high',
              searchDomainFilter: ['-reddit.com'],
              userLocation: { country: 'US' }
            }
          },
          {
            type: 'provider',
            name: 'urlContext',
            id: 'perplexity.fetch_url',
            args: { maxUrls: 3 }
          },
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

  it('omits server tools when no provider-defined tool is supplied', async () => {
    const req = await captureWithFetch((fetch) =>
      new PerplexityAgentLanguageModel('perplexity/sonar', config(fetch)).doGenerate({
        prompt: prompt('Q')
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
        tools: [
          { type: 'provider', name: 'webSearch', id: 'perplexity.web_search', args: {} },
          { type: 'function', name: 'lookup', inputSchema: { type: 'object', properties: {} } }
        ],
        toolChoice: { type: 'none' }
      })
    )

    expect(req.body).not.toHaveProperty('tools')
  })

  it('replays three client-function steps exactly, including parallel calls', async () => {
    const bodies: Array<Record<string, unknown>> = []
    const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      const response = (() => {
        switch (bodies.length) {
          case 1:
            return {
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
                },
                {
                  type: 'function_call',
                  id: 'fc-2',
                  status: 'completed',
                  name: 'lookup_order',
                  call_id: 'call-2',
                  arguments: '{"orderId":"ORD-2"}',
                  thought_signature: 'sig-2'
                }
              ]
            }
          case 2:
            return {
              id: 'r2',
              status: 'completed',
              model: 'openai/gpt-5.6-sol',
              output: [
                {
                  type: 'function_call',
                  id: 'fc-3',
                  status: 'completed',
                  name: 'lookup_order',
                  call_id: 'call-3',
                  arguments: '{"orderId":"ORD-3"}',
                  thought_signature: 'sig-3'
                }
              ]
            }
          default:
            return {
              id: 'r3',
              status: 'completed',
              model: 'openai/gpt-5.6-sol',
              output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Done' }] }]
            }
        }
      })()
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
      stopWhen: stepCountIs(3)
    })

    expect(result.text).toBe('Done')
    expect(execute).toHaveBeenCalledTimes(3)
    expect(bodies).toHaveLength(3)
    expect(bodies[1].input).toEqual([
      { type: 'message', role: 'user', content: 'Where is ORD-1?' },
      {
        type: 'function_call',
        call_id: 'call-1',
        name: 'lookup_order',
        arguments: '{"orderId":"ORD-1"}',
        thought_signature: 'sig-1'
      },
      {
        type: 'function_call',
        call_id: 'call-2',
        name: 'lookup_order',
        arguments: '{"orderId":"ORD-2"}',
        thought_signature: 'sig-2'
      },
      {
        type: 'function_call_output',
        call_id: 'call-1',
        name: 'lookup_order',
        output: '{"orderId":"ORD-1","status":"shipped"}',
        thought_signature: 'sig-1'
      },
      {
        type: 'function_call_output',
        call_id: 'call-2',
        name: 'lookup_order',
        output: '{"orderId":"ORD-2","status":"shipped"}',
        thought_signature: 'sig-2'
      }
    ])
    expect(bodies[2].input).toEqual([
      ...(bodies[1].input as unknown[]),
      {
        type: 'function_call',
        call_id: 'call-3',
        name: 'lookup_order',
        arguments: '{"orderId":"ORD-3"}',
        thought_signature: 'sig-3'
      },
      {
        type: 'function_call_output',
        call_id: 'call-3',
        name: 'lookup_order',
        output: '{"orderId":"ORD-3","status":"shipped"}',
        thought_signature: 'sig-3'
      }
    ])
  })

  it('replays server-tool results before a client function result in a mixed step', async () => {
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
                  type: 'search_results',
                  queries: ['ORD-1 shipping status'],
                  results: [{ url: 'https://shipping.example/ord-1', title: 'Tracking', snippet: 'In transit' }]
                },
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
              output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'In transit' }] }]
            }
      return new Response(JSON.stringify(response), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as typeof globalThis.fetch

    const result = await generateText({
      model: new PerplexityAgentLanguageModel('openai/gpt-5.6-sol', config(fetch)),
      prompt: 'Where is ORD-1?',
      tools: {
        webSearch: perplexityTools.webSearch({ maxResults: 5 }),
        lookup_order: tool({
          inputSchema: z.object({ orderId: z.string() }),
          execute: async ({ orderId }) => ({ orderId, status: 'in_transit' })
        })
      },
      stopWhen: stepCountIs(2)
    })

    expect(result.text).toBe('In transit')
    expect(bodies[1].input).toEqual([
      { type: 'message', role: 'user', content: 'Where is ORD-1?' },
      {
        type: 'search_results',
        queries: ['ORD-1 shipping status'],
        results: [{ url: 'https://shipping.example/ord-1', title: 'Tracking', snippet: 'In transit' }]
      },
      {
        type: 'function_call',
        call_id: 'call-1',
        name: 'lookup_order',
        arguments: '{"orderId":"ORD-1"}',
        thought_signature: 'sig-1'
      },
      {
        type: 'function_call_output',
        call_id: 'call-1',
        name: 'lookup_order',
        output: '{"orderId":"ORD-1","status":"in_transit"}',
        thought_signature: 'sig-1'
      }
    ])
  })

  it('uses previous_response_id without replaying its stored function call', async () => {
    const req = await captureWithFetch((fetch) =>
      new PerplexityAgentLanguageModel('openai/gpt-5.6-sol', config(fetch)).doGenerate({
        prompt: [
          {
            role: 'assistant',
            content: [
              {
                type: 'tool-call',
                toolCallId: 'call-1',
                toolName: 'lookup_order',
                input: { orderId: 'ORD-1' },
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
                toolName: 'lookup_order',
                output: { type: 'json', value: { status: 'shipped' } }
              }
            ]
          }
        ],
        providerOptions: { perplexity: { previousResponseId: 'r1', store: true } }
      })
    )

    expect(req.body).toMatchObject({
      previous_response_id: 'r1',
      store: true,
      input: [
        {
          type: 'function_call_output',
          call_id: 'call-1',
          name: 'lookup_order',
          output: '{"status":"shipped"}',
          thought_signature: 'sig-1'
        }
      ]
    })
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
