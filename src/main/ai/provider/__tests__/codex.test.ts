import { describe, expect, it } from 'vitest'

import { buildCodexRequestHeaders, coerceCodexRequestBody } from '../codex'

describe('coerceCodexRequestBody', () => {
  it('forces store:false and adds encrypted reasoning to include', () => {
    const out = coerceCodexRequestBody(JSON.stringify({ model: 'gpt-5.5', store: true }))
    const json = JSON.parse(out as string)
    expect(json.store).toBe(false)
    expect(json.include).toEqual(['reasoning.encrypted_content'])
  })

  it('preserves existing include entries without duplicating', () => {
    const out = coerceCodexRequestBody(
      JSON.stringify({ include: ['file_search_call.results', 'reasoning.encrypted_content'] })
    )
    const json = JSON.parse(out as string)
    expect(json.include).toEqual(['file_search_call.results', 'reasoning.encrypted_content'])
  })

  it('passes through non-string and non-JSON bodies untouched', () => {
    expect(coerceCodexRequestBody(undefined)).toBeUndefined()
    expect(coerceCodexRequestBody('not json')).toBe('not json')
  })
})

describe('buildCodexRequestHeaders', () => {
  it('sets the bearer token, account id and codex markers', () => {
    const headers = buildCodexRequestHeaders(
      { 'content-type': 'application/json' },
      { accessToken: 'tok', accountId: 'acct-1' }
    )
    expect(headers.get('Authorization')).toBe('Bearer tok')
    expect(headers.get('chatgpt-account-id')).toBe('acct-1')
    expect(headers.get('OpenAI-Beta')).toBe('responses=experimental')
    expect(headers.get('originator')).toBe('cherry-studio')
    expect(headers.get('content-type')).toBe('application/json')
  })

  it('omits the account id header when none is known', () => {
    const headers = buildCodexRequestHeaders(undefined, { accessToken: 'tok', accountId: null })
    expect(headers.has('chatgpt-account-id')).toBe(false)
  })
})
