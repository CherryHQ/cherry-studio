import { describe, expect, it } from 'vitest'

import { decrypt, encrypt } from '../aes'

const key = '12345678901234567890123456789012' // 32字节
const iv = '1234567890abcdef1234567890abcdef' // 32字节hex，实际应16字节hex

function getIv16() {
  // 取前16字节作为 hex
  return iv.slice(0, 32)
}

describe('aes utils', () => {
  it('should encrypt and decrypt normal string', () => {
    const text = 'hello world'
    const { iv: outIv, encryptedData } = encrypt(text, key, getIv16())
    expect(typeof encryptedData).toBe('string')
    expect(outIv).toBe(getIv16())
    const decrypted = decrypt(encryptedData, getIv16(), key)
    expect(decrypted).toBe(text)
  })

  it('should support unicode and special chars', () => {
    const text = '你好，世界！🌟🚀'
    const { encryptedData } = encrypt(text, key, getIv16())
    const decrypted = decrypt(encryptedData, getIv16(), key)
    expect(decrypted).toBe(text)
  })

  it('should handle empty string', () => {
    const text = ''
    const { encryptedData } = encrypt(text, key, getIv16())
    const decrypted = decrypt(encryptedData, getIv16(), key)
    expect(decrypted).toBe(text)
  })

  it('should encrypt and decrypt long string', () => {
    const text = 'a'.repeat(100_000)
    const { encryptedData } = encrypt(text, key, getIv16())
    const decrypted = decrypt(encryptedData, getIv16(), key)
    expect(decrypted).toBe(text)
  })

  it('should throw error for wrong key', () => {
    const text = 'test'
    const { encryptedData } = encrypt(text, key, getIv16())
    expect(() => decrypt(encryptedData, getIv16(), 'wrongkeywrongkeywrongkeywrongkey')).toThrow()
  })

  it('should throw error for wrong iv', () => {
    const text = 'test'
    const { encryptedData } = encrypt(text, key, getIv16())
    expect(() => decrypt(encryptedData, 'abcdefabcdefabcdefabcdefabcdefab', key)).toThrow()
  })

  it('should throw error for invalid key/iv length', () => {
    expect(() => encrypt('test', 'shortkey', getIv16())).toThrow()
    expect(() => encrypt('test', key, 'shortiv')).toThrow()
  })

  it('should throw error for invalid encrypted data', () => {
    expect(() => decrypt('nothexdata', getIv16(), key)).toThrow()
  })

  it('should throw error for non-string input', () => {
    // @ts-expect-error purposely pass wrong type to test error branch
    expect(() => encrypt(null, key, getIv16())).toThrow()
    // @ts-expect-error purposely pass wrong type to test error branch
    expect(() => decrypt(null, getIv16(), key)).toThrow()
  })
})
