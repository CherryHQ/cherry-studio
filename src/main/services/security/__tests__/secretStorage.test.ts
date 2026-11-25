import { afterEach, describe, expect, it } from 'vitest'

import {
  decryptApiKeyEntries,
  decryptSecret,
  decryptSecretRecord,
  encryptApiKeyEntries,
  encryptSecret,
  encryptSecretRecord,
  isEncryptedSecret,
  isSecretStorageAvailable,
  SecretDecryptionError,
  setSecretCipherBackendForTests,
  tryDecryptSecret
} from '../secretStorage'

const PREFIX = 'enc:v1:'

const fakeBackend = {
  isEncryptionAvailable: () => true,
  encryptString: (plainText: string) => Buffer.from(`sealed:${plainText}`, 'utf8'),
  decryptString: (encrypted: Buffer) => encrypted.toString('utf8').replace(/^sealed:/, '')
}

afterEach(() => {
  setSecretCipherBackendForTests(undefined)
})

describe('secretStorage', () => {
  it('encrypts with the OS-backed cipher and never stores the plaintext', () => {
    setSecretCipherBackendForTests(fakeBackend)

    const encrypted = encryptSecret('sk-live-secret')

    expect(encrypted.startsWith(PREFIX)).toBe(true)
    expect(encrypted).not.toContain('sk-live-secret')
    expect(isEncryptedSecret(encrypted)).toBe(true)
    expect(decryptSecret(encrypted)).toBe('sk-live-secret')
  })

  it('passes plaintext legacy values through and does not double-encrypt', () => {
    setSecretCipherBackendForTests(fakeBackend)

    expect(decryptSecret('legacy-plaintext')).toBe('legacy-plaintext')

    const encrypted = encryptSecret('value')
    expect(encryptSecret(encrypted)).toBe(encrypted)
  })

  it('leaves values unchanged when the OS keyring is unavailable', () => {
    setSecretCipherBackendForTests({ ...fakeBackend, isEncryptionAvailable: () => false })

    expect(isSecretStorageAvailable()).toBe(false)
    expect(encryptSecret('value')).toBe('value')
  })

  it('reports unreadable ciphertext without exposing it as a credential', () => {
    setSecretCipherBackendForTests({
      ...fakeBackend,
      decryptString: () => {
        throw new Error('keyring changed')
      }
    })

    const ciphertext = `${PREFIX}AAAA`
    expect(() => decryptSecret(ciphertext)).toThrow(SecretDecryptionError)
    expect(tryDecryptSecret(ciphertext)).toBeUndefined()
  })

  it('encrypts API key entries and secret records while preserving metadata', () => {
    setSecretCipherBackendForTests(fakeBackend)

    const entries = encryptApiKeyEntries([{ id: 'key-1', key: 'sk-secret', label: 'Primary', isEnabled: true }])
    expect(entries[0].key.startsWith(PREFIX)).toBe(true)
    expect(entries[0]).toMatchObject({ id: 'key-1', label: 'Primary', isEnabled: true })
    expect(decryptApiKeyEntries(entries)).toEqual([
      { id: 'key-1', key: 'sk-secret', label: 'Primary', isEnabled: true }
    ])

    const record = encryptSecretRecord({ API_KEY: 'secret-value', REGION: 'us-east-1' })
    expect(record?.API_KEY.startsWith(PREFIX)).toBe(true)
    expect(record?.REGION.startsWith(PREFIX)).toBe(true)
    expect(decryptSecretRecord(record)).toEqual({ API_KEY: 'secret-value', REGION: 'us-east-1' })
  })
})
