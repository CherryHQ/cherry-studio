/**
 * Tests for createCustomParamsFetch
 * Verifies that custom provider params are injected into POST body at low precedence,
 * bypassing the AI SDK adapter's zod schema stripping. See issue #16041.
 */

import { describe, expect, it, vi } from 'vitest'

import { createCustomParamsFetch } from '../customParamsFetch'

describe('createCustomParamsFetch', () => {
  it('should return innerFetch unchanged when customParams is empty', async () => {
    const innerFetch = vi.fn()
    const result = createCustomParamsFetch(innerFetch, {})
    expect(result).toBe(innerFetch)
  })

  it('should inject custom params into POST body', async () => {
    let capturedBody: any = null
    const innerFetch = vi.fn(async (_url: any, init?: any) => {
      capturedBody = JSON.parse(init.body)
      return new Response('{}', { status: 200 })
    })

    const wrapped = createCustomParamsFetch(innerFetch, { n: 3, enable_search: true })
    await wrapped('https://example.com/api', {
      method: 'POST',
      body: JSON.stringify({ model: 'gpt-4o', messages: [] })
    })

    expect(capturedBody).toEqual({
      model: 'gpt-4o',
      messages: [],
      n: 3,
      enable_search: true
    })
  })

  it('should NOT overwrite body fields that already exist (low precedence)', async () => {
    let capturedBody: any = null
    const innerFetch = vi.fn(async (_url: any, init?: any) => {
      capturedBody = JSON.parse(init.body)
      return new Response('{}', { status: 200 })
    })

    // SDK already set store:true in the body — custom param store:false must NOT overwrite it
    const wrapped = createCustomParamsFetch(innerFetch, { store: false, n: 3 })
    await wrapped('https://example.com/api', {
      method: 'POST',
      body: JSON.stringify({ model: 'gpt-4o', store: true })
    })

    expect(capturedBody.store).toBe(true) // body wins
    expect(capturedBody.n).toBe(3) // injected because not in body
  })

  it('should pass through non-JSON bodies unchanged', async () => {
    let receivedInit: any = null
    const innerFetch = vi.fn(async (_url: any, init?: any) => {
      receivedInit = init
      return new Response('{}', { status: 200 })
    })

    const formData = new FormData()
    formData.append('file', 'data')

    const wrapped = createCustomParamsFetch(innerFetch, { n: 3 })
    await wrapped('https://example.com/api', {
      method: 'POST',
      body: formData
    })

    // FormData is not a string → passed through unchanged
    expect(receivedInit.body).toBe(formData)
  })

  it('should pass through invalid JSON body unchanged', async () => {
    let receivedBody: any = null
    const innerFetch = vi.fn(async (_url: any, init?: any) => {
      receivedBody = init.body
      return new Response('{}', { status: 200 })
    })

    const wrapped = createCustomParamsFetch(innerFetch, { n: 3 })
    await wrapped('https://example.com/api', {
      method: 'POST',
      body: 'not-json{{{'
    })

    expect(receivedBody).toBe('not-json{{{')
  })

  it('should pass through GET requests unchanged', async () => {
    let receivedBody: any = null
    const innerFetch = vi.fn(async (_url: any, init?: any) => {
      receivedBody = init?.body
      return new Response('{}', { status: 200 })
    })

    const wrapped = createCustomParamsFetch(innerFetch, { n: 3 })
    await wrapped('https://example.com/api', {
      method: 'GET'
    })

    expect(receivedBody).toBeUndefined()
  })

  it('should handle JSON-type values (objects, arrays, null)', async () => {
    let capturedBody: any = null
    const innerFetch = vi.fn(async (_url: any, init?: any) => {
      capturedBody = JSON.parse(init.body)
      return new Response('{}', { status: 200 })
    })

    const wrapped = createCustomParamsFetch(innerFetch, {
      cache_control: { type: 'ephemeral' },
      tags: ['a', 'b'],
      null_val: null
    })
    await wrapped('https://example.com/api', {
      method: 'POST',
      body: JSON.stringify({ model: 'claude-3' })
    })

    expect(capturedBody.cache_control).toEqual({ type: 'ephemeral' })
    expect(capturedBody.tags).toEqual(['a', 'b'])
    expect(capturedBody.null_val).toBeNull()
  })

  it('should chain with an existing fetch wrapper', async () => {
    const order: string[] = []
    const baseFetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      void url
      void init
      order.push('base')
      return new Response('{}', { status: 200 })
    })

    // Simulate an existing wrapper (e.g. CherryAI signature)
    const signatureFetch = vi.fn(async (url: any, init?: any) => {
      order.push('signature')
      return baseFetch(url, { ...init, headers: { ...init?.headers, 'X-Signature': 'abc' } })
    })

    const wrapped = createCustomParamsFetch(signatureFetch, { n: 3 })
    await wrapped('https://example.com/api', {
      method: 'POST',
      body: JSON.stringify({ model: 'gpt-4o' })
    })

    expect(order).toEqual(['signature', 'base'])
  })
})
