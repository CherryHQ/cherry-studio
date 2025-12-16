import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getDecryptedLocalStorageItem, setEncryptedLocalStorageItem } from '../secureStorage'

describe('secureStorage', () => {
  beforeEach(() => {
    localStorage.clear()

    const safeStorage = {
      isEncryptionAvailable: vi.fn(() => true),
      encryptString: vi.fn((plainText: string) => {
        if (plainText.startsWith('csenc:')) return plainText
        return `csenc:${Buffer.from(plainText, 'utf-8').toString('base64')}`
      }),
      decryptString: vi.fn((value: string) => {
        const prefix = 'csenc:'
        if (!value.startsWith(prefix)) return value
        try {
          return Buffer.from(value.slice(prefix.length), 'base64').toString('utf-8')
        } catch {
          return value
        }
      })
    }

    ;(window as any).api = { ...(window as any).api, safeStorage }
  })

  it('migrates legacy plaintext localStorage values to encrypted-at-rest storage', () => {
    localStorage.setItem('plain', 'value')

    expect(getDecryptedLocalStorageItem('plain')).toBe('value')
    expect(localStorage.getItem('plain')).toMatch(/^csenc:/)
  })

  it('stores encrypted values via setEncryptedLocalStorageItem and reads them back', () => {
    setEncryptedLocalStorageItem('token', 'secret-token')
    expect(localStorage.getItem('token')).toMatch(/^csenc:/)
    expect(getDecryptedLocalStorageItem('token')).toBe('secret-token')
  })

  it('removes encrypted localStorage values that can no longer be decrypted', () => {
    setEncryptedLocalStorageItem('token', 'secret-token')
    expect(localStorage.getItem('token')).toMatch(/^csenc:/)

    ;(window as any).api.safeStorage.decryptString = vi.fn((value: string) => value)

    expect(getDecryptedLocalStorageItem('token')).toBeNull()
    expect(localStorage.getItem('token')).toBeNull()
  })
})
