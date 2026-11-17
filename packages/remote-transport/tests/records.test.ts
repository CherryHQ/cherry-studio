import * as native from 'node:crypto'

import { pureJsCrypto } from '@libp2p/noise'
import { expect, it } from 'vitest'

import { isUploadChunk } from '@cherrystudio/remote-protocol'

import { createNativeNoiseCrypto } from '../src/crypto'
import { decodeRecord, encodeRecord } from '../src/records'

it('round trips a MiB block while keeping control records bounded and existing JSON framing unchanged', () => {
  const chunk = {
    kind: 'upload',
    requestId: 'r',
    uploadId: 'u',
    writerEpoch: '2',
    offset: '1048576',
    bytes: native.randomBytes(1024 * 1024)
  }
  const decoded = decodeRecord(encodeRecord(chunk))
  if (!isUploadChunk(decoded)) throw new Error('Expected an upload record')
  expect(Buffer.from(decoded.bytes).equals(chunk.bytes)).toBe(true)
  expect(decoded.offset).toBe(chunk.offset)
  expect(() => encodeRecord({ ...chunk, bytes: new Uint8Array(1024 * 1024 + 1) })).toThrow()
  expect(() => encodeRecord({ text: 'x'.repeat(65536) })).toThrow()
  const json = encodeRecord({ hello: '世界' })
  expect(JSON.parse(new TextDecoder().decode(json))).toEqual({ hello: '世界' })
  expect(decodeRecord(json)).toEqual({ hello: '世界' })
  const invalid = encodeRecord(chunk).subarray(0, 3)
  expect(() => decodeRecord(invalid)).toThrow()
})

it('native Noise crypto interoperates with the existing implementation and rejects altered ciphertext', () => {
  const crypto = createNativeNoiseCrypto(native)
  const bytes = native.randomBytes(65500)
  const key = native.randomBytes(32)
  const nonce = native.randomBytes(12)
  const ad = native.randomBytes(32)
  const encrypted = crypto.chaCha20Poly1305Encrypt(bytes, nonce, ad, key).subarray()
  expect(
    Buffer.from(encrypted).equals(Buffer.from(pureJsCrypto.chaCha20Poly1305Encrypt(bytes, nonce, ad, key).subarray()))
  ).toBe(true)
  expect(Buffer.from(crypto.chaCha20Poly1305Decrypt(encrypted, nonce, ad, key).subarray()).equals(bytes)).toBe(true)
  expect(Buffer.from(pureJsCrypto.chaCha20Poly1305Decrypt(encrypted, nonce, ad, key).subarray()).equals(bytes)).toBe(
    true
  )
  expect(Buffer.from(crypto.hashSHA256(bytes)).equals(Buffer.from(pureJsCrypto.hashSHA256(bytes)))).toBe(true)
  encrypted[12] ^= 1
  expect(() => crypto.chaCha20Poly1305Decrypt(encrypted, nonce, ad, key)).toThrow()
})

it.each([
  ['null', null],
  ['true', true],
  ['2.5', 2.5],
  ['"text"', 'text'],
  ['[1,{"ok":true}]', [1, { ok: true }]]
])('decodes the JSON control value %s', (wire, expected) => {
  expect(decodeRecord(new TextEncoder().encode(String(wire)))).toEqual(expected)
})

it.each(['1e999', '{"__proto__":{"number":1e999}}', '{"unfinished":', 'undefined'])(
  'rejects a control record that cannot represent a JSON value: %s',
  (wire) => {
    expect(() => decodeRecord(new TextEncoder().encode(wire))).toThrow()
  }
)

it('preserves reserved and nested keys in JSON records', () => {
  const wire = '{"__proto__":{"kept":true},"constructor":"value","nested":{"__proto__":5}}'
  const decoded = decodeRecord(new TextEncoder().encode(wire))
  if (typeof decoded !== 'object' || decoded === null) throw new Error('Expected an object record')
  expect(JSON.stringify(decoded)).toBe(wire)
  expect(Object.hasOwn(decoded, '__proto__')).toBe(true)
})
