import { hmac } from '@noble/hashes/hmac.js'
import { sha1 } from '@noble/hashes/legacy.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

/** Browser `node:crypto` subset used by the data and AI services. */
const HASHES = { sha1, sha256 }
type HashName = keyof typeof HASHES

type Encoding = 'hex' | 'base64url'

function encode(bytes: Uint8Array, encoding: string | undefined, caller: string): string {
  if (encoding === 'hex') return bytesToHex(bytes)
  if (encoding === 'base64url') {
    return btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
  }
  throw new Error(`${caller}: unsupported encoding "${encoding}" in the browser`)
}

function hashFor(algorithm: string) {
  const hash = HASHES[algorithm as HashName]
  if (!hash) throw new Error(`createHash(): unsupported algorithm "${algorithm}" in the browser`)
  return hash
}

/** Synchronous `update(...).digest(encoding)` chains of UTF-8 text or bytes, as the services use them. */
class Digest {
  readonly #chunks: Uint8Array[] = []
  readonly #finish: (data: Uint8Array) => Uint8Array

  constructor(finish: (data: Uint8Array) => Uint8Array) {
    this.#finish = finish
  }

  update(data: string | Uint8Array): this {
    this.#chunks.push(typeof data === 'string' ? utf8ToBytes(data) : data)
    return this
  }

  digest(encoding: Encoding): string {
    const data = new Uint8Array(this.#chunks.reduce((size, chunk) => size + chunk.length, 0))
    let offset = 0
    for (const chunk of this.#chunks) {
      data.set(chunk, offset)
      offset += chunk.length
    }
    return encode(this.#finish(data), encoding, 'digest()')
  }
}

export function createHash(algorithm: string): Digest {
  const hash = hashFor(algorithm)
  return new Digest((data) => hash(data))
}

export function createHmac(algorithm: string, key: string | Uint8Array): Digest {
  const hash = hashFor(algorithm)
  return new Digest((data) => hmac(hash, typeof key === 'string' ? utf8ToBytes(key) : key, data))
}

class RandomBytes extends Uint8Array {
  override toString(encoding?: string): string {
    return encode(this, encoding, 'randomBytes()')
  }
}

export function randomBytes(size: number): RandomBytes {
  return crypto.getRandomValues(new RandomBytes(size))
}

export function randomUUID(): string {
  return crypto.randomUUID()
}

/** Reads every byte whatever the inputs hold, so the time taken does not reveal where they differ. */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) throw new RangeError('Input buffers must have the same byte length')
  let difference = 0
  for (let index = 0; index < a.length; index++) difference |= a[index] ^ b[index]
  return difference === 0
}
