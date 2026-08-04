import { describe, expect, it } from 'vitest'

import { kimiWebSearchEchoTool, transformMoonshotRequestBody } from '../moonshotProvider'

describe('transformMoonshotRequestBody', () => {
  it('rewrites the $web_search declaration to builtin_function and keeps normal tools', () => {
    const fn = { type: 'function', function: { name: 'lookup', description: 'x', parameters: {} } }
    const body = transformMoonshotRequestBody({
      tools: [fn, { type: 'function', function: { name: '$web_search', description: 'y', parameters: {} } }]
    })
    expect(body.tools).toEqual([fn, { type: 'builtin_function', function: { name: '$web_search' } }])
  })

  it('rewrites replayed assistant tool_calls for $web_search to builtin_function', () => {
    const body = transformMoonshotRequestBody({
      messages: [
        { role: 'user', content: 'hi' },
        {
          role: 'assistant',
          tool_calls: [
            { id: 'c1', type: 'function', function: { name: '$web_search', arguments: '{"q":1}' } },
            { id: 'c2', type: 'function', function: { name: 'lookup', arguments: '{}' } }
          ]
        },
        { role: 'tool', tool_call_id: 'c1', content: '{"q":1}' }
      ]
    })
    expect(body.messages[1].tool_calls).toEqual([
      { id: 'c1', type: 'builtin_function', function: { name: '$web_search', arguments: '{"q":1}' } },
      { id: 'c2', type: 'function', function: { name: 'lookup', arguments: '{}' } }
    ])
    expect(body.messages[0]).toEqual({ role: 'user', content: 'hi' })
  })

  // The second request is what actually runs the search: Kimi matches the echoed result to its call
  // by `tool_call_id` AND `name`, but the SDK serializes tool results without a name.
  it('names the echoed $web_search tool result on the follow-up request', () => {
    const body = transformMoonshotRequestBody({
      tools: [{ type: 'function', function: { name: '$web_search', parameters: {} } }],
      messages: [
        { role: 'user', content: 'hi' },
        {
          role: 'assistant',
          tool_calls: [
            { id: 'c1', type: 'function', function: { name: '$web_search', arguments: '{"q":1}' } },
            { id: 'c2', type: 'function', function: { name: 'lookup', arguments: '{}' } }
          ]
        },
        { role: 'tool', tool_call_id: 'c1', content: '{"q":1}' },
        { role: 'tool', tool_call_id: 'c2', content: 'result' }
      ]
    })

    expect(body.messages[2]).toEqual({ role: 'tool', tool_call_id: 'c1', name: '$web_search', content: '{"q":1}' })
    // A normal function's result must stay untouched.
    expect(body.messages[3]).toEqual({ role: 'tool', tool_call_id: 'c2', content: 'result' })
  })

  it('is a no-op without $web_search anywhere', () => {
    const args = { tools: [{ type: 'function', function: { name: 'lookup' } }], messages: [{ role: 'user' }] }
    expect(transformMoonshotRequestBody(args)).toBe(args)
  })
})

describe('kimiWebSearchEchoTool', () => {
  it('echoes the tool-call arguments back verbatim', async () => {
    const input = { search_id: 'abc', usage: { total_tokens: 42 } }
    await expect(
      (kimiWebSearchEchoTool.execute as (i: unknown, o: unknown) => Promise<unknown>)(input, {})
    ).resolves.toBe(input)
  })
})
