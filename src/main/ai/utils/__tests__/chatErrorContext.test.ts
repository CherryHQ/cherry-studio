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
  it('retains the message and nested cause of a plain error object', () => {
    expect(
      chatErrorContext({ name: 'TransportError', message: 'socket hang up', cause: { message: 'connection reset' } })
    ).toMatchObject({
      errorName: 'TransportError',
      errorMessage: 'socket hang up',
      cause: { errorMessage: 'connection reset' }
    })
  })

  it('does not log provider echoes or malformed response text, including SDK-generated messages and stacks', () => {
    const secret = 'private medical question'
    const responseBody = JSON.stringify({ error: { code: 'invalid_request_error', message: secret }, prompt: secret })
    const errors = [
      new APICallError({
        message: responseBody,
        url: 'https://api.example.com',
        requestBodyValues: { messages: [{ role: 'user', content: secret }] },
        responseBody,
        statusCode: 400
      }),
      new APICallError({
        message: secret,
        url: 'https://api.example.com',
        requestBodyValues: {},
        responseBody: secret,
        statusCode: 400
      }),
      new JSONParseError({ text: `{"content":"${secret}",`, cause: new SyntaxError('Unexpected end of JSON input') }),
      new JSONParseError({ text: secret, cause: new SyntaxError(`Unexpected token: "${secret}"`) }),
      new TypeValidationError({ value: { content: secret }, cause: new Error('Invalid response') }),
      { responseBody: `<html>${secret}</html>` },
      { responseBody: secret }
    ]

    for (const error of errors) expect(JSON.stringify(chatErrorContext(error))).not.toContain(secret)
    expect(
      JSON.stringify(
        chatErrorContext(
          new RetryError({
            message: `Failed after 3 attempts: ${secret}`,
            reason: 'maxRetriesExceeded',
            errors: [errors[0]]
          })
        )
      )
    ).not.toContain(secret)
    expect(
      JSON.stringify(chatErrorContext(new Error(`Response rejected: ${secret}`, { cause: errors[0] })))
    ).not.toContain(secret)
  })

  it('keeps the failing exchange diagnosable: status, url routing, request shape and provider code', () => {
    const context = chatErrorContext(apiCallError())

    expect(context.statusCode).toBe(429)
    expect(context.url).toBe('https://api.example.com/v1/chat/completions?api_key=%3Credacted%3E')
    expect(context.errorName).toBe('AI_APICallError')
    expect(context.responseBody).toMatchObject({ error: { code: 'rate_limit_exceeded' } })
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

    expect(context.value).toMatchObject({ choices: [{ message: { role: '<string:9>', content: null } }] })
    expect(context.cause).toMatchObject({ text: '<string:12>' })
  })

  it('describes a non-Error throw instead of producing an empty context', () => {
    expect(chatErrorContext('socket hang up')).toEqual({ errorMessage: 'socket hang up' })
  })

  it('normalizes credential-bearing messages on plain errors and terminates cyclic causes', () => {
    const error: Record<string, unknown> = { message: 'connection failed token=private', code: 'ECONNRESET' }
    error.cause = error
    const context = chatErrorContext(error)

    expect(context.errorMessage).toContain('connection failed')
    expect(context.code).toBe('ECONNRESET')
    expect(JSON.stringify(context)).not.toContain('private')
    expect(JSON.stringify(context)).toContain('<max-depth>')
  })
})
