import { describe, expect, it } from 'vitest'

import { ENDPOINT_TYPE } from '@shared/data/types/model'

import { createChatFunctionToolReasoningFetch, normalizeChatFunctionToolReasoning } from '../openaiChatCompatibility'

const chat = ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
const tools = [{ type: 'function', function: { name: 'lookup', parameters: { type: 'object' } } }]
const body = { model: 'gpt-5.6-luna', tools, reasoning_effort: 'high', messages: [], stream: true, store: false }

describe('chat function tool reasoning compatibility', () => {
  it.each(['gpt-5.6-luna', 'gpt-5.6-sol', 'gpt-6-sol', 'gpt-6-astra', 'AZ-GPT-6-Luna'])(
    'prevents the relay conflict for exact wire id %s without losing other fields',
    (model) => {
      const input = { ...body, model }
      const result = normalizeChatFunctionToolReasoning(chat, '', input)
      expect(result).toEqual({ ...input, reasoning_effort: 'none' })
      expect(result.tools).toBe(input.tools)
      expect(result.messages).toBe(input.messages)
      expect(input.reasoning_effort).toBe('high')
    }
  )

  it.each(['gpt-6-luna', 'gpt-6.1-sol', 'gpt-4o', 'gpt-6-sol-2026-01-01', 'gpt_6_sol', 'relay/gpt-6-sol'])(
    'does not widen the policy to %s and preserves the original object',
    (model) => {
      const input = { ...body, model }
      expect(normalizeChatFunctionToolReasoning(chat, 'gpt-6-sol', input)).toBe(input)
    }
  )

  it.each([undefined, ENDPOINT_TYPE.OPENAI_RESPONSES])('leaves endpoint %s untouched', (endpoint) => {
    expect(normalizeChatFunctionToolReasoning(endpoint, '', body)).toBe(body)
  })

  it.each([
    { tools: undefined },
    { tools: [] },
    { tools: [{ type: 'web_search' }, null] },
    { reasoning_effort: 'none' },
    { reasoning_effort: ' NONE ' },
    { reasoning_effort: '' },
    { reasoning_effort: '  ' },
    { reasoning_effort: undefined },
    { reasoning_effort: 1 },
    { reasoning_effort: null }
  ])('preserves no-op input identity for %j', (override) => {
    const input = { ...body, ...override }
    expect(normalizeChatFunctionToolReasoning(chat, '', input)).toBe(input)
  })

  it.each([undefined, '', '   ', 12])('uses the configured wire id when model is %j', (model) => {
    expect(normalizeChatFunctionToolReasoning(chat, ' GPT-6-SOL ', { ...body, model }).reasoning_effort).toBe('none')
  })

  it('retains mixed native and function declarations while normalizing a custom tier', () => {
    const input = {
      ...body,
      model: ' GPT-6-SOL ',
      tools: [{ type: 'web_search' }, ...tools],
      reasoning_effort: 'custom'
    }
    expect(normalizeChatFunctionToolReasoning(chat, '', input)).toEqual({ ...input, reasoning_effort: 'none' })
  })
})

describe('compatibility fetch boundary', () => {
  it('reuses wrappers only for the same inner fetch and wire model id', () => {
    const innerFetch: typeof globalThis.fetch = async () => new Response('ok')
    const otherFetch: typeof globalThis.fetch = async () => new Response('ok')
    const wrapped = createChatFunctionToolReasoningFetch(innerFetch, chat, 'gpt-6-sol')

    expect(createChatFunctionToolReasoningFetch(innerFetch, chat, 'gpt-6-sol')).toBe(wrapped)
    expect(createChatFunctionToolReasoningFetch(innerFetch, chat, 'gpt-6-astra')).not.toBe(wrapped)
    expect(createChatFunctionToolReasoningFetch(otherFetch, chat, 'gpt-6-sol')).not.toBe(wrapped)
  })

  async function capture(init?: RequestInit) {
    let captured: { input: RequestInfo | URL; init?: RequestInit } | undefined
    const response = new Response('ok')
    const fetch = createChatFunctionToolReasoningFetch(
      async (input, options) => {
        captured = { input, init: options }
        return response
      },
      chat,
      'gpt-6-sol'
    )
    const url = new URL('https://relay.invalid/chat/completions')
    expect(await fetch(url, init)).toBe(response)
    expect(captured?.input).toBe(url)
    return captured?.init
  }

  it('changes only the conflicting JSON field and retains request options', async () => {
    const init = {
      method: 'post',
      body: JSON.stringify(body),
      headers: { authorization: 'test' },
      signal: new AbortController().signal
    }
    const result = await capture(init)
    expect(result).toEqual({ ...init, body: JSON.stringify({ ...body, reasoning_effort: 'none' }) })
  })

  it.each([
    undefined,
    { method: 'GET', body: JSON.stringify(body) },
    { body: JSON.stringify(body) },
    { method: 'POST', body: new URLSearchParams('a=b') },
    { method: 'POST', body: 'not json' },
    { method: 'POST', body: '{' },
    { method: 'POST', body: 'null' },
    { method: 'POST', body: '[]' },
    { method: 'POST', body: '42' },
    { method: 'POST', body: JSON.stringify({ ...body, tools: [] }, null, 2) }
  ])('passes nonmatching request %j through with init and bytes unchanged', async (init) => {
    expect(await capture(init)).toBe(init)
  })
})
