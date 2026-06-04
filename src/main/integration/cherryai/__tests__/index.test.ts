import { createHmac } from 'node:crypto'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { SignatureClient } from '..'

describe('CherryAI signature', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('generates stable HMAC-SHA256 headers from the canonical request string', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)

    const client = new SignatureClient('test-client', 'test-secret')
    const body = {
      model: 'qwen',
      messages: [{ role: 'user', content: 'hello' }]
    }

    const headers = client.generateSignature({
      method: 'post',
      path: '/chat/completions',
      query: 'stream=true',
      body
    })

    const signatureString = ['POST', '/chat/completions', 'stream=true', 'test-client', '1700000000', JSON.stringify(body)].join(
      '\n'
    )
    const signature = createHmac('sha256', 'test-secret').update(signatureString).digest('hex')

    expect(headers).toEqual({
      'X-Client-ID': 'test-client',
      'X-Timestamp': '1700000000',
      'X-Signature': signature
    })
  })
})
