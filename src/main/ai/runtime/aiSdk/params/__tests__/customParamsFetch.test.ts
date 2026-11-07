import { describe, expect, it, vi } from 'vitest'

import { ENDPOINT_TYPE } from '@shared/data/types/model'

import { createCustomParamsFetch, selectCustomBodyParameters } from '../customParamsFetch'

function createInnerFetch() {
  return vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 204 }))
}

describe('selectCustomBodyParameters', () => {
  it('keeps flat parameters and excludes SDK and raw-provider namespaces regardless of value shape', () => {
    expect(
      selectCustomBodyParameters(
        {
          openai: 'invalid-namespace-value',
          cherryin: false,
          enable_search: true,
          custom_snake_case: { nested: 'value' }
        },
        { openai: {} },
        'cherryin'
      )
    ).toEqual({
      enable_search: true,
      custom_snake_case: { nested: 'value' }
    })
  })
})

describe('createCustomParamsFetch', () => {
  it('returns the inner fetch unchanged when there are no custom parameters', () => {
    const innerFetch = createInnerFetch()

    expect(createCustomParamsFetch(innerFetch, {}, ENDPOINT_TYPE.ANTHROPIC_MESSAGES)).toBe(innerFetch)
  })

  it('passes non-POST requests through unchanged', async () => {
    const innerFetch = createInnerFetch()
    const init: RequestInit = { method: 'GET' }

    await createCustomParamsFetch(
      innerFetch,
      { enable_search: true },
      ENDPOINT_TYPE.ANTHROPIC_MESSAGES
    )('https://example.com', init)

    expect(innerFetch.mock.calls[0][1]).toBe(init)
  })

  it('passes non-string request bodies through unchanged', async () => {
    const innerFetch = createInnerFetch()
    const body = new FormData()
    const init: RequestInit = { method: 'POST', body }

    await createCustomParamsFetch(
      innerFetch,
      { enable_search: true },
      ENDPOINT_TYPE.ANTHROPIC_MESSAGES
    )('https://example.com', init)

    expect(innerFetch.mock.calls[0][1]).toBe(init)
  })

  it('passes invalid JSON request bodies through unchanged', async () => {
    const innerFetch = createInnerFetch()
    const init: RequestInit = { method: 'POST', body: 'not-json{{{' }

    await createCustomParamsFetch(
      innerFetch,
      { enable_search: true },
      ENDPOINT_TYPE.ANTHROPIC_MESSAGES
    )('https://example.com', init)

    expect(innerFetch.mock.calls[0][1]).toBe(init)
  })

  it.each(['null', '[]', 'true'])('passes non-object JSON body %s through unchanged', async (body) => {
    const innerFetch = createInnerFetch()
    const init: RequestInit = { method: 'POST', body }

    await createCustomParamsFetch(
      innerFetch,
      { enable_search: true },
      ENDPOINT_TYPE.ANTHROPIC_MESSAGES
    )('https://example.com', init)

    expect(innerFetch.mock.calls[0][1]).toBe(init)
  })

  it('injects custom parameters at lower precedence than SDK-produced fields', async () => {
    const innerFetch = createInnerFetch()
    const wrappedFetch = createCustomParamsFetch(
      innerFetch,
      {
        model: 'custom-model',
        store: false,
        enable_search: true
      },
      ENDPOINT_TYPE.ANTHROPIC_MESSAGES
    )

    await wrappedFetch('https://example.com', {
      method: 'POST',
      body: JSON.stringify({ model: 'sdk-model', store: true, messages: [] })
    })

    const forwardedInit = innerFetch.mock.calls[0][1] as RequestInit
    expect(JSON.parse(forwardedInit.body as string)).toEqual({
      model: 'sdk-model',
      store: true,
      enable_search: true,
      messages: []
    })
  })

  it('reuses wrappers for the same inner fetch and serialized custom parameters', () => {
    const innerFetch = createInnerFetch()
    const first = createCustomParamsFetch(innerFetch, { enable_search: true }, ENDPOINT_TYPE.ANTHROPIC_MESSAGES)
    const second = createCustomParamsFetch(innerFetch, { enable_search: true }, ENDPOINT_TYPE.ANTHROPIC_MESSAGES)

    expect(second).toBe(first)
    expect(createCustomParamsFetch(innerFetch, { enable_search: false }, ENDPOINT_TYPE.ANTHROPIC_MESSAGES)).not.toBe(
      first
    )
    expect(
      createCustomParamsFetch(createInnerFetch(), { enable_search: true }, ENDPOINT_TYPE.ANTHROPIC_MESSAGES)
    ).not.toBe(first)
  })
})

describe('Anthropic adaptive thinking raw-body guard', () => {
  const diagnostic = {
    name: 'InvalidAdaptiveThinkingBudgetError',
    message:
      'Adaptive thinking does not accept budget_tokens. Remove thinking.budget_tokens, or use enabled thinking if the model supports it.'
  }
  const conflict = { type: 'adaptive', budget_tokens: 2048 }
  const post = { method: 'POST', body: '{"messages":[]}' }

  it.each([2048, 0, -1, null, '2048', true, { tokens: 2048 }])(
    'rejects adaptive with own budget_tokens=%j before transport on every invocation',
    async (budget) => {
      const innerFetch = createInnerFetch()
      const customParams = { thinking: { type: 'adaptive', budget_tokens: budget } }
      const wrapped = createCustomParamsFetch(innerFetch, customParams, ENDPOINT_TYPE.ANTHROPIC_MESSAGES)
      for (let step = 0; step < 2; step++) {
        await expect(wrapped('https://example.com', post)).rejects.toMatchObject(diagnostic)
      }
      expect(innerFetch).not.toHaveBeenCalled()
      expect(customParams.thinking.budget_tokens).toEqual(budget)
    }
  )

  it('also rejects a conflict supplied by the SDK body after merging', async () => {
    const innerFetch = createInnerFetch()
    const wrapped = createCustomParamsFetch(innerFetch, { unrelated: true }, ENDPOINT_TYPE.ANTHROPIC_MESSAGES)
    await expect(
      wrapped('https://example.com', {
        method: 'post',
        body: JSON.stringify({ thinking: conflict })
      })
    ).rejects.toMatchObject(diagnostic)
    expect(innerFetch).not.toHaveBeenCalled()
  })

  it.each([
    { type: 'adaptive' },
    { type: 'adaptive', display: 'summarized', block_binding: { enabled: true } },
    { type: 'adaptive', budgetTokens: 2048 },
    { type: 'enabled', budget_tokens: 2048 },
    { type: 'disabled' },
    { type: 'between_tools', budget_tokens: 2048 },
    { type: 'Adaptive', budget_tokens: 2048 },
    null,
    [],
    'adaptive',
    false
  ])('preserves existing merged bytes for nonconflicting thinking %j', async (thinking) => {
    const innerFetch = createInnerFetch()
    const wrapped = createCustomParamsFetch(
      innerFetch,
      { thinking, unrelated: 'kept' },
      ENDPOINT_TYPE.ANTHROPIC_MESSAGES
    )
    await wrapped('https://example.com', post)
    expect(innerFetch.mock.calls[0][1]?.body).toBe(JSON.stringify({ thinking, unrelated: 'kept', messages: [] }))
  })

  it('lets SDK thinking replace the entire invalid raw object', async () => {
    const innerFetch = createInnerFetch()
    const wrapped = createCustomParamsFetch(
      innerFetch,
      { thinking: conflict, unrelated: 1 },
      ENDPOINT_TYPE.ANTHROPIC_MESSAGES
    )
    const sdkBody = { thinking: { type: 'adaptive', display: 'summarized' }, messages: [] }
    await wrapped('https://example.com', { method: 'POST', body: JSON.stringify(sdkBody) })
    expect(innerFetch.mock.calls[0][1]?.body).toBe(
      '{"thinking":{"type":"adaptive","display":"summarized"},"unrelated":1,"messages":[]}'
    )
    expect(conflict).toEqual({ type: 'adaptive', budget_tokens: 2048 })
  })

  it.each([ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT])(
    'preserves the same raw conflict on %s even when the Anthropic wrapper is cached',
    async (endpoint) => {
      const innerFetch = createInnerFetch()
      const customParams = { thinking: conflict }
      const anthropic = createCustomParamsFetch(innerFetch, customParams, ENDPOINT_TYPE.ANTHROPIC_MESSAGES)
      const wrapped = createCustomParamsFetch(innerFetch, customParams, endpoint)
      expect(wrapped).not.toBe(anthropic)
      await wrapped('https://example.com', post)
      expect(innerFetch.mock.calls[0][1]?.body).toBe(
        '{"thinking":{"type":"adaptive","budget_tokens":2048},"messages":[]}'
      )
    }
  )

  it('does not inspect messages, tool inputs, extra_body or task_budget', async () => {
    const innerFetch = createInnerFetch()
    const nested = { thinking: conflict }
    const body = {
      messages: [{ role: 'user', content: [{ type: 'tool_result', content: nested }] }],
      tool_input: nested
    }
    const custom = { extra_body: nested, task_budget: nested }
    await createCustomParamsFetch(
      innerFetch,
      custom,
      ENDPOINT_TYPE.ANTHROPIC_MESSAGES
    )('https://example.com', {
      method: 'POST',
      body: JSON.stringify(body)
    })
    expect(innerFetch.mock.calls[0][1]?.body).toBe(JSON.stringify({ ...custom, ...body }))
  })

  it.each<RequestInit>([
    { method: 'GET', body: '{"thinking":{"type":"adaptive","budget_tokens":1}}' },
    { method: 'POST', body: new FormData() },
    { method: 'POST', body: 'not-json' },
    ...['null', '[]', 'true', '1', '"text"'].map((body) => ({ method: 'POST', body }))
  ])('passes unsupported request shapes through unchanged: %j', async (init) => {
    const innerFetch = createInnerFetch()
    await createCustomParamsFetch(
      innerFetch,
      { thinking: conflict },
      ENDPOINT_TYPE.ANTHROPIC_MESSAGES
    )('https://example.com', init)
    expect(innerFetch.mock.calls[0][1]).toBe(init)
  })

  it('propagates the inner transport error unchanged', async () => {
    const failure = new Error('transport failed')
    const innerFetch = createInnerFetch().mockRejectedValue(failure)
    await expect(
      createCustomParamsFetch(
        innerFetch,
        { thinking: { type: 'adaptive' } },
        ENDPOINT_TYPE.ANTHROPIC_MESSAGES
      )('https://example.com', post)
    ).rejects.toBe(failure)
  })

  it('uses the original custom-parameter snapshot after the caller mutates it', async () => {
    const innerFetch = createInnerFetch()
    const custom = { thinking: { type: 'adaptive' }, unrelated: 'original' }
    const wrapped = createCustomParamsFetch(innerFetch, custom, ENDPOINT_TYPE.ANTHROPIC_MESSAGES)
    Object.assign(custom.thinking, { budget_tokens: 2048 })
    custom.unrelated = 'mutated'
    await wrapped('https://example.com', post)
    expect(innerFetch.mock.calls[0][1]?.body).toBe(
      '{"thinking":{"type":"adaptive"},"unrelated":"original","messages":[]}'
    )
  })
})
