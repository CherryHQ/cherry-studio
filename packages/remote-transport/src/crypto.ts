import { pureJsCrypto } from '@libp2p/noise'

export type NoiseCrypto = typeof pureJsCrypto
interface Cipher {
  setAAD(bytes: Uint8Array): unknown
  update(bytes: Uint8Array): Uint8Array
  final(): Uint8Array
}
export interface NativeCrypto {
  createHash(algorithm: string): { update(bytes: Uint8Array): unknown; digest(): Uint8Array }
  createCipheriv(
    algorithm: string,
    key: Uint8Array,
    nonce: Uint8Array,
    options: { authTagLength: number }
  ): Cipher & { getAuthTag(): Uint8Array }
  createDecipheriv(
    algorithm: string,
    key: Uint8Array,
    nonce: Uint8Array,
    options: { authTagLength: number }
  ): Cipher & { setAuthTag(bytes: Uint8Array): unknown }
}
const concat = (...parts: Uint8Array[]) => {
  const bytes = new Uint8Array(parts.reduce((length, part) => length + part.length, 0))
  let offset = 0
  for (const part of parts) {
    bytes.set(part, offset)
    offset += part.length
  }
  return bytes
}

/** Native bulk encryption; Noise continues to own key exchange, nonces and authentication. */
export function createNativeNoiseCrypto(native: NativeCrypto): NoiseCrypto {
  return {
    ...pureJsCrypto,
    hashSHA256(data) {
      const hash = native.createHash('sha256')
      hash.update(data.subarray())
      return hash.digest()
    },
    chaCha20Poly1305Encrypt(plaintext, nonce, ad, key) {
      const cipher = native.createCipheriv('chacha20-poly1305', key, nonce, { authTagLength: 16 })
      cipher.setAAD(ad)
      return concat(cipher.update(plaintext.subarray()), cipher.final(), cipher.getAuthTag())
    },
    chaCha20Poly1305Decrypt(ciphertext, nonce, ad, key, dst) {
      const bytes = ciphertext.subarray()
      if (bytes.length < 16) throw new Error('Invalid authentication tag')
      const cipher = native.createDecipheriv('chacha20-poly1305', key, nonce, { authTagLength: 16 })
      cipher.setAAD(ad)
      cipher.setAuthTag(bytes.subarray(-16))
      const plain = concat(cipher.update(bytes.subarray(0, -16)), cipher.final())
      if (dst) {
        dst.set(plain)
        return dst.subarray(0, plain.length)
      }
      return plain
    }
  }
}
