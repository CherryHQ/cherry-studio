import { createHash, createPrivateKey, createPublicKey } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { createAuthorizationSecrets, createDeviceKeyPair, createDeviceSignature } from '../crypto'

describe('Cherry Cloud authorization cryptography', () => {
  it('derives the S256 PKCE challenge from the verifier', () => {
    const { codeVerifier, codeChallenge } = createAuthorizationSecrets()

    expect(codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(codeChallenge).toBe(createHash('sha256').update(codeVerifier, 'ascii').digest('base64url'))
  })

  it('exports the Ed25519 device public key in raw base64url form', () => {
    const { publicKey, privateKey } = createDeviceKeyPair()
    const privateKeyObject = createPrivateKey({
      key: Buffer.from(privateKey, 'base64'),
      format: 'der',
      type: 'pkcs8'
    })
    const derivedPublicKey = createPublicKey(privateKeyObject).export({ format: 'jwk' })

    expect(Buffer.from(publicKey, 'base64url')).toHaveLength(32)
    expect(derivedPublicKey).toMatchObject({ kty: 'OKP', crv: 'Ed25519', x: publicKey })
  })
})

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
})
