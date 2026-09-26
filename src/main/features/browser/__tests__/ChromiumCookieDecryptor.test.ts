import * as os from 'node:os'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as keyStore from '../import/browserCookieKey'
import { ChromiumCookieDecryptor } from '../import/ChromiumCookieDecryptor'
import { CookieImportError } from '../import/CookieImportError'

vi.mock('../import/browserCookieKey', () => ({
  readBrowserCookiePassword: vi.fn(),
  readWindowsCookieKey: vi.fn(),
  unprotectWindowsData: vi.fn()
}))

// CBC known answers were generated with Python hashlib + openssl enc, independently of the importer.
const fixtures = {
  darwin: {
    legacy: 'djEwUr4Yum6i07YYXjNsa0SPkg==',
    bound: 'djEw35xrQgi6fgRM/ulqefycN722porHXe3MSx0b/0nlhxYQAtq5/Kdi1MuT1Uq/S3av',
    empty: 'djEw35xrQgi6fgRM/ulqefycN722porHXe3MSx0b/0nlhxbE2PioogtEyjybyKyrXyfo'
  },
  linux: {
    legacy: 'djEw5HQQMMZGvM5Bq9Qk3Ou/sQ==',
    bound: 'djEwG7ZUgz+m+KcxUo25LWV9w3yHVEqBunh10GgSc1Q7Tk8sjVwXWsZ4L5bXikdaxyFH',
    empty: 'djEwG7ZUgz+m+KcxUo25LWV9w3yHVEqBunh10GgSc1Q7Tk8Xy+h5l+h2DB/7sRfHAPZT'
  }
}
const decryptors: ChromiumCookieDecryptor[] = []
const create = (version = 24, signal = new AbortController().signal) => {
  const decryptor = new ChromiumCookieDecryptor('chrome', version, signal)
  decryptors.push(decryptor)
  return decryptor
}
beforeEach(() => {
  vi.mocked(keyStore.readBrowserCookiePassword)
    .mockReset()
    .mockImplementation(async () => Buffer.from('test-keyring-password'))
  vi.mocked(keyStore.readWindowsCookieKey)
    .mockReset()
    .mockImplementation(async () => Buffer.alloc(32))
  vi.mocked(keyStore.unprotectWindowsData).mockReset()
})
afterEach(async () => {
  for (const decryptor of decryptors.splice(0)) await decryptor.dispose()
  vi.restoreAllMocks()
})

describe('Chromium cookie decryption', () => {
  it.each(['darwin', 'linux'] as const)(
    'decodes %s cookies according to the database version, preserving empty values',
    async (platform) => {
      vi.spyOn(os, 'platform').mockReturnValue(platform)
      expect(await create(23).decrypt(Buffer.from(fixtures[platform].legacy, 'base64'), '.example.com')).toBe(
        'fixture-value'
      )
      const decryptor = create()
      expect(await decryptor.decrypt(Buffer.from(fixtures[platform].bound, 'base64'), '.example.com')).toBe(
        'fixture-value'
      )
      expect(await decryptor.decrypt(Buffer.from(fixtures[platform].empty, 'base64'), '.example.com')).toBe('')
      await expect(
        decryptor.decrypt(Buffer.from(fixtures[platform].bound, 'base64'), 'example.com')
      ).rejects.toMatchObject({ reason: 'decryption_failed' })
      if (platform === 'linux') expect(keyStore.readBrowserCookiePassword).not.toHaveBeenCalled()
    }
  )

  it('uses one keyring lookup for Linux v11 cookies and erases the returned password', async () => {
    vi.spyOn(os, 'platform').mockReturnValue('linux')
    const password = Buffer.from('test-keyring-password')
    vi.mocked(keyStore.readBrowserCookiePassword).mockResolvedValue(password)
    const encrypted = Buffer.from('djExD4unLwiaP8CMOTX4+d7WNLpxlTW95abQ+bRRHCxkZKuF4zS6/Eg224Vm4jxkXgnL', 'base64')
    const decryptor = create()
    expect(await decryptor.decrypt(encrypted, '.example.com')).toBe('fixture-value')
    expect(await decryptor.decrypt(encrypted, '.example.com')).toBe('fixture-value')
    expect(keyStore.readBrowserCookiePassword).toHaveBeenCalledTimes(1)
    expect(password).toEqual(Buffer.alloc(password.length))
  })

  it('decrypts a Windows AES-256-GCM known answer and rejects a modified authentication tag', async () => {
    vi.spyOn(os, 'platform').mockReturnValue('win32')
    const encrypted = Buffer.concat([
      Buffer.from('v10'),
      Buffer.alloc(12),
      Buffer.from('cea7403d4d606b6e074ec5d3baf39d18d0d1c8a799996bf0265b98b5d48ab919', 'hex')
    ])
    const key = Buffer.alloc(32)
    vi.mocked(keyStore.readWindowsCookieKey).mockResolvedValue(key)
    const decryptor = create(23)
    expect(await decryptor.decrypt(encrypted, 'example.com')).toBe('\0'.repeat(16))
    encrypted[encrypted.length - 1] ^= 1
    await expect(decryptor.decrypt(encrypted, 'example.com')).rejects.toMatchObject({ reason: 'decryption_failed' })
    expect(keyStore.readWindowsCookieKey).toHaveBeenCalledTimes(1)
    key.fill(1)
    await decryptor.dispose()
    expect(key).toEqual(Buffer.alloc(32))
  })

  it('distinguishes Windows app-bound cookies from legacy DPAPI without trying the wrong key', async () => {
    vi.spyOn(os, 'platform').mockReturnValue('win32')
    const decryptor = create(23)
    await expect(decryptor.decrypt(Buffer.from('v20fixture'), 'example.com')).rejects.toMatchObject({
      reason: 'app_bound'
    })
    await expect(decryptor.decrypt(Buffer.from('v99fixture'), 'example.com')).rejects.toMatchObject({
      reason: 'unsupported_encryption'
    })
    expect(keyStore.readWindowsCookieKey).not.toHaveBeenCalled()
    expect(keyStore.unprotectWindowsData).not.toHaveBeenCalled()
    vi.mocked(keyStore.unprotectWindowsData).mockResolvedValue(Buffer.from('legacy-value'))
    expect(
      await decryptor.decrypt(Buffer.from('01000000d08c9ddf0115d1118c7a00c04fc297eb00', 'hex'), 'example.com')
    ).toBe('legacy-value')
  })

  it('does not repeat denied prompts and never substitutes an empty or legacy key', async () => {
    vi.spyOn(os, 'platform').mockReturnValue('darwin')
    vi.mocked(keyStore.readBrowserCookiePassword).mockRejectedValue(new CookieImportError('access_denied'))
    const decryptor = create()
    for (let i = 0; i < 3; i++) {
      await expect(
        decryptor.decrypt(Buffer.from(fixtures.darwin.bound, 'base64'), '.example.com')
      ).rejects.toMatchObject({ reason: 'access_denied' })
    }
    expect(keyStore.readBrowserCookiePassword).toHaveBeenCalledTimes(1)
  })

  it('rejects wrong keys, corrupt CBC data and unknown database metadata', async () => {
    vi.spyOn(os, 'platform').mockReturnValue('darwin')
    vi.mocked(keyStore.readBrowserCookiePassword).mockResolvedValue(Buffer.from('wrong-password'))
    await expect(create().decrypt(Buffer.from(fixtures.darwin.bound, 'base64'), '.example.com')).rejects.toMatchObject({
      reason: 'decryption_failed'
    })
    await expect(create().decrypt(Buffer.from('v10broken'), '.example.com')).rejects.toMatchObject({
      reason: 'decryption_failed'
    })
    await expect(
      create(NaN).decrypt(Buffer.from(fixtures.darwin.bound, 'base64'), '.example.com')
    ).rejects.toMatchObject({ reason: 'unsupported_encryption' })
  })

  it('propagates cancellation during key retrieval and erases a late password', async () => {
    vi.spyOn(os, 'platform').mockReturnValue('darwin')
    const abort = new AbortController()
    const password = Buffer.from('test-keyring-password')
    vi.mocked(keyStore.readBrowserCookiePassword).mockImplementation(async () => {
      abort.abort(new Error('import stopped'))
      return password
    })
    await expect(
      create(24, abort.signal).decrypt(Buffer.from(fixtures.darwin.bound, 'base64'), '.example.com')
    ).rejects.toThrow('import stopped')
    expect(password).toEqual(Buffer.alloc(password.length))
  })
})
