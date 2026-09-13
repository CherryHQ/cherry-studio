import { APICallError, JSONParseError, RetryError, TypeValidationError } from 'ai'
import { describe, expect, it } from 'vitest'

import { chatErrorContext } from '../chatErrorContext'

function apiCallError(): APICallError {
  return new APICallError({
    message: 'Provider rejected the request',
    url: 'https://api.example.com/v1/chat/completions?api_key=sk-live-secret',
    requestBodyValues: {
      model: 'gpt-5',
      max_tokens: 4096,
      messages: [{ role: 'user', content: 'my confidential prompt '.repeat(10) }],
      tools: [{ type: 'function', function: { name: 'search_web' } }]
    },
    statusCode: 429,
    responseHeaders: { 'content-type': 'application/json', 'set-cookie': 'session=abc' },
    responseBody: JSON.stringify({ error: { message: 'rate limit reached', code: 'rate_limit_exceeded' } })
  })
}

describe('chatErrorContext', () => {
  it('keeps the failing exchange diagnosable: status, url routing, request shape, provider message', () => {
    const context = chatErrorContext(apiCallError())

    expect(context.statusCode).toBe(429)
    expect(context.url).toBe('https://api.example.com/v1/chat/completions?api_key=%3Credacted%3E')
    expect(context.errorMessage).toBe('Provider rejected the request')
    expect(context.responseBody).toContain('rate_limit_exceeded')
    expect(context.responseHeaders).toMatchObject({ 'content-type': 'application/json' })
    expect(context.requestShape).toMatchObject({
      model: 'gpt-5',
      max_tokens: 4096,
      messages: [{ role: 'user' }],
      tools: [{ function: { name: 'search_web' } }]
    })
  })

  it('leaks neither the prompt nor credentials into the log payload', () => {
    const serialized = JSON.stringify(chatErrorContext(apiCallError()))

    expect(serialized).not.toContain('my confidential prompt')
    expect(serialized).not.toContain('sk-live-secret')
    expect(serialized).not.toContain('session=abc')
  })

  it('unwraps the provider failure a RetryError hides behind "failed after 3 attempts"', () => {
    const context = chatErrorContext(
      new RetryError({ message: 'Failed after 3 attempts', reason: 'maxRetriesExceeded', errors: [apiCallError()] })
    )

    expect(context.reason).toBe('maxRetriesExceeded')
    expect(context.lastError).toMatchObject({ statusCode: 429 })
  })

  it('keeps what we failed to parse when the response shape is the bug', () => {
    const context = chatErrorContext(
      new TypeValidationError({
        value: { choices: [{ message: { role: 'assistant', content: null } }] },
        cause: new JSONParseError({ text: '{"choices":[', cause: new SyntaxError('Unexpected end of JSON input') })
      })
    )

    expect(context.value).toMatchObject({ choices: [{ message: { role: 'assistant', content: null } }] })
    expect(context.cause).toMatchObject({ text: '{"choices":[' })
  })

  it('describes a non-Error throw instead of producing an empty context', () => {
    expect(chatErrorContext('socket hang up')).toEqual({ errorMessage: 'socket hang up' })
  })
})
