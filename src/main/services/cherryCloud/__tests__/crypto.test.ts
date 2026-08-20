import { describe, expect, it } from 'vitest'

import { createDeviceSignature, createIdempotencyKey } from '../crypto'

describe('Cherry Cloud device request signing', () => {
  it('matches the protocol Ed25519 fixture', () => {
    const seed = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60'
    const privateKey = Buffer.from(`302e020100300506032b657004220420${seed}`, 'hex').toString('base64')
    const body = Buffer.from(
      '{"model":"deepseek-chat","max_tokens":64,"messages":[{"role":"user","content":"Hello"}]}',
      'utf8'
    )

    expect(
      createDeviceSignature({
        privateKey,
        method: 'POST',
        requestTarget: '/v1/messages',
        body,
        idempotencyKey: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8',
        now: new Date(1_710_000_000_000),
        requestId: '018f47a2-7d3b-7c91-b8f5-8b3f4c6d2a10'
      })
    ).toEqual({
      'Cherry-Request-ID': '018f47a2-7d3b-7c91-b8f5-8b3f4c6d2a10',
      'Cherry-Timestamp': '1710000000',
      'Cherry-Body-SHA256': '862ece927adfbee83d138acac6f093c1d67272618334e96886fb8c11a62097ff',
      'Cherry-Signature-Version': '1',
      'Cherry-Signature': '68XKbmorIHWYnCZAKXGbDVzRzM3qSKTRBx2Kj6xuGnZtOUyWtoLbN7JNAAJGc93-QDagy_OrmxfqKyrpdEwfCQ'
    })
  })

  it('creates a canonical 32-byte idempotency key', () => {
    expect(createIdempotencyKey()).toMatch(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/)
  })
})
