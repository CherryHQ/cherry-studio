import { hmac } from '@noble/hashes/hmac.js'
import { sha1 } from '@noble/hashes/legacy.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

/** Browser `node:crypto` subset used by the data and AI services. */
const HASHES = { sha1, sha256 }
type HashName = keyof typeof HASHES

function hashFor(algorithm: string) {
  const hash = HASHES[algorithm as HashName]
  if (!hash) throw new Error(`createHash(): unsupported algorithm "${algorithm}" in the browser`)
  return hash
}

/** Synchronous `update(...).digest('hex')` chains, as the services use them. */
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

  digest(encoding: 'hex'): string {
    if (encoding !== 'hex') throw new Error(`digest(): unsupported encoding "${encoding}" in the browser`)
    const data = new Uint8Array(this.#chunks.reduce((size, chunk) => size + chunk.length, 0))
    let offset = 0
    for (const chunk of this.#chunks) {
      data.set(chunk, offset)
      offset += chunk.length
    }
    return bytesToHex(this.#finish(data))
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
    if (encoding !== 'hex') throw new Error(`randomBytes(): unsupported encoding "${encoding}" in the browser`)
    return Array.from(this, (byte) => byte.toString(16).padStart(2, '0')).join('')
  }
}

export function randomBytes(size: number): RandomBytes {
  return crypto.getRandomValues(new RandomBytes(size))
}

export function randomUUID(): string {
  return crypto.randomUUID()
}
