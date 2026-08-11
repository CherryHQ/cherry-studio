import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { describe, expect, it } from 'vitest'

import { createArkResponsesFetch, stripArkUnsupportedIncludes } from '../ark'

const parse = (body: BodyInit | null | undefined) => JSON.parse(body as string)

describe('stripArkUnsupportedIncludes', () => {
  it('drops the include the Responses adapter pairs with the web_search tool', () => {
    const body = JSON.stringify({
      model: 'doubao-seed-2-1-pro-260628',
      include: ['web_search_call.action.sources', 'reasoning.encrypted_content'],
      tools: [{ type: 'web_search' }]
    })
    expect(parse(stripArkUnsupportedIncludes(body)).include).toEqual(['reasoning.encrypted_content'])
  })

  it('omits include entirely when nothing supported is left', () => {
    const body = JSON.stringify({ include: ['web_search_call.action.sources'] })
    expect(parse(stripArkUnsupportedIncludes(body))).not.toHaveProperty('include')
  })

  it('passes through bodies with no offending include', () => {
    const body = JSON.stringify({ include: ['reasoning.encrypted_content'] })
    expect(stripArkUnsupportedIncludes(body)).toBe(body)
    expect(stripArkUnsupportedIncludes(undefined)).toBeUndefined()
  })
})

const responseBody = {
  id: 'resp_mock',
  object: 'response',
  created_at: 0,
  model: 'doubao-seed-1-6-251015',
  output: [
    {
      type: 'message',
      role: 'assistant',
      id: 'msg_mock',
      status: 'completed',
      content: [{ type: 'output_text', text: 'ok' }]
    }
  ],
  status: 'completed'
}

const prompt = [
  { role: 'system' as const, content: 'test' },
  { role: 'user' as const, content: [{ type: 'text' as const, text: 'hi' }] }
]

describe('Doubao Responses compatibility boundary', () => {
  it('captures equivalent health-check requests and accepts Ark output without annotations', async () => {
    const requests: Array<{ url: string; method?: string; headers: Headers; body: Record<string, unknown> }> = []
    const arkFetch = createArkResponsesFetch(async (input, init) => {
      requests.push({
        url: String(input),
        method: init?.method,
        headers: new Headers(init?.headers),
        body: JSON.parse(String(init?.body))
      })
      return new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    })
    const customFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        method: init?.method,
        headers: new Headers(init?.headers),
        body: JSON.parse(String(init?.body))
      })
      return new Response(
        JSON.stringify({
          id: 'chat_mock',
          object: 'chat.completion',
          created: 0,
          model: 'doubao-seed-1-6-251015',
          choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    }

    const builtin = createOpenAI({
      baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
      apiKey: 'sk-REDACTED',
      fetch: arkFetch
    }).responses('doubao-seed-1-6-251015')
    const custom = createOpenAICompatible({
      name: 'custom',
      baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
      apiKey: 'sk-REDACTED',
      fetch: customFetch
    }).chatModel('doubao-seed-1-6-251015')

    await expect(builtin.doGenerate({ prompt })).resolves.toMatchObject({
      content: [{ type: 'text', text: 'ok' }]
    })
    await expect(custom.doGenerate({ prompt })).resolves.toMatchObject({
      content: [{ type: 'text', text: 'ok' }]
    })

    expect(requests[0]).toMatchObject({
      url: 'https://ark.cn-beijing.volces.com/api/v3/responses',
      method: 'POST',
      body: {
        model: 'doubao-seed-1-6-251015',
        input: [
          { role: 'system', content: 'test' },
          { role: 'user', content: [{ type: 'input_text', text: 'hi' }] }
        ]
      }
    })
    expect(requests[1]).toMatchObject({
      url: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
      method: 'POST',
      body: {
        model: 'doubao-seed-1-6-251015',
        messages: [
          { role: 'system', content: 'test' },
          { role: 'user', content: 'hi' }
        ]
      }
    })
  })

  it('adds completed status when replaying assistant text to Ark', async () => {
    let requestBody: Record<string, unknown> | undefined
    const fetch = createArkResponsesFetch(async (_input, init) => {
      requestBody = JSON.parse(String(init?.body))
      return new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    })
    const model = createOpenAI({
      baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
      apiKey: 'sk-REDACTED',
      fetch
    }).responses('doubao-seed-1-6-251015')

    await model.doGenerate({
      prompt: [
        { role: 'user', content: [{ type: 'text', text: 'first' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'answer' }] },
        { role: 'user', content: [{ type: 'text', text: 'second' }] }
      ]
    })

    expect(requestBody?.input).toEqual([
      { role: 'user', content: [{ type: 'input_text', text: 'first' }] },
      { role: 'assistant', content: [{ type: 'output_text', text: 'answer' }], status: 'completed' },
      { role: 'user', content: [{ type: 'input_text', text: 'second' }] }
    ])
  })

  it('leaves non-success responses untouched for diagnostics', async () => {
    const errorBody = JSON.stringify({ error: { code: 'MissingParameter', param: 'input.status' } })
    const fetch = createArkResponsesFetch(async () => new Response(errorBody, { status: 400 }))
    const response = await fetch('https://ark.cn-beijing.volces.com/api/v3/responses', { method: 'POST' })

    expect(response.status).toBe(400)
    await expect(response.text()).resolves.toBe(errorBody)
  })
})
