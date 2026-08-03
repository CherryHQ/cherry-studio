import { describe, expect, it, vi } from 'vitest'

import { createCustomParamsFetch, selectCustomBodyParameters } from '../customParamsFetch'

function createInnerFetch() {
  return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(null, { status: 204 }))
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

    expect(createCustomParamsFetch(innerFetch, {})).toBe(innerFetch)
  })

  it('passes non-POST requests through unchanged', async () => {
    const innerFetch = createInnerFetch()
    const init: RequestInit = { method: 'GET' }

    await createCustomParamsFetch(innerFetch, { enable_search: true })('https://example.com', init)

    expect(innerFetch).toHaveBeenCalledWith('https://example.com', init)
  })

  it('passes non-string request bodies through unchanged', async () => {
    const innerFetch = createInnerFetch()
    const body = new FormData()
    const init: RequestInit = { method: 'POST', body }

    await createCustomParamsFetch(innerFetch, { enable_search: true })('https://example.com', init)

    expect(innerFetch).toHaveBeenCalledWith('https://example.com', init)
  })

  it('passes invalid JSON request bodies through unchanged', async () => {
    const innerFetch = createInnerFetch()
    const init: RequestInit = { method: 'POST', body: 'not-json{{{' }

    await createCustomParamsFetch(innerFetch, { enable_search: true })('https://example.com', init)

    expect(innerFetch).toHaveBeenCalledWith('https://example.com', init)
  })

  it.each(['null', '[]', 'true'])('passes non-object JSON body %s through unchanged', async (body) => {
    const innerFetch = createInnerFetch()
    const init: RequestInit = { method: 'POST', body }

    await createCustomParamsFetch(innerFetch, { enable_search: true })('https://example.com', init)

    expect(innerFetch).toHaveBeenCalledWith('https://example.com', init)
  })

  it('injects custom parameters at lower precedence than SDK-produced fields', async () => {
    const innerFetch = createInnerFetch()
    const wrappedFetch = createCustomParamsFetch(innerFetch, {
      model: 'custom-model',
      store: false,
      enable_search: true
    })

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
    const first = createCustomParamsFetch(innerFetch, { enable_search: true })
    const second = createCustomParamsFetch(innerFetch, { enable_search: true })

    expect(second).toBe(first)
    expect(createCustomParamsFetch(innerFetch, { enable_search: false })).not.toBe(first)
    expect(createCustomParamsFetch(createInnerFetch(), { enable_search: true })).not.toBe(first)
  })
})
