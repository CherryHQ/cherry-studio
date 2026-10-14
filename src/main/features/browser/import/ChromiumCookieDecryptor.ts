import { createDecipheriv, createHash, pbkdf2Sync, timingSafeEqual } from 'node:crypto'
import { platform } from 'node:os'

import type { BrowserImportSource } from '@shared/ipc/schemas/browserImport'

import { readBrowserCookiePassword, readWindowsCookieKey, unprotectWindowsData } from './browserCookieKey'
import { CookieImportError } from './CookieImportError'

export class ChromiumCookieDecryptor {
  private readonly os = platform()
  private readonly keys = new Map<string, Promise<Buffer>>()

  constructor(
    private readonly browser: Exclude<BrowserImportSource['browser'], 'firefox'>,
    private readonly databaseVersion: number,
    private readonly signal: AbortSignal
  ) {}

  private getKey(version: string): Promise<Buffer> {
    let key = this.keys.get(version)
    if (!key) {
      key = this.loadKey(version)
      this.keys.set(version, key)
    }
    return key
  }

  private async loadKey(version: string): Promise<Buffer> {
    if (this.os === 'win32') return readWindowsCookieKey(this.browser, this.signal)
    const password =
      this.os === 'linux' && version === 'v10'
        ? Buffer.from('peanuts')
        : await readBrowserCookiePassword(this.browser, this.signal)
    try {
      this.signal.throwIfAborted()
      return pbkdf2Sync(password, 'saltysalt', this.os === 'darwin' ? 1003 : 1, 16, 'sha1')
    } finally {
      password.fill(0)
    }
  }

  async decrypt(encrypted: Buffer, host: string): Promise<string> {
    this.signal.throwIfAborted()
    const version = encrypted.subarray(0, 3).toString('ascii')
    if (this.os === 'win32' && version === 'v20') throw new CookieImportError('app_bound')
    const legacyDpapi =
      this.os === 'win32' && encrypted.subarray(0, 20).toString('hex') === '01000000d08c9ddf0115d1118c7a00c04fc297eb'
    if (!legacyDpapi && version !== 'v10' && !(this.os === 'linux' && version === 'v11')) {
      throw new CookieImportError('unsupported_encryption')
    }
    if (!Number.isInteger(this.databaseVersion) || this.databaseVersion < 1) {
      throw new CookieImportError('unsupported_encryption')
    }
    let plain: Buffer | undefined
    try {
      if (legacyDpapi) plain = await unprotectWindowsData(encrypted, this.signal)
      else {
        const key = await this.getKey(version)
        this.signal.throwIfAborted()
        if (this.os === 'win32') {
          if (encrypted.length < 31) throw new CookieImportError('decryption_failed')
          const decipher = createDecipheriv('aes-256-gcm', key, encrypted.subarray(3, 15))
          decipher.setAuthTag(encrypted.subarray(-16))
          plain = Buffer.concat([decipher.update(encrypted.subarray(15, -16)), decipher.final()])
        } else {
          const decipher = createDecipheriv('aes-128-cbc', key, Buffer.alloc(16, 32))
          plain = Buffer.concat([decipher.update(encrypted.subarray(3)), decipher.final()])
        }
      }
      let value = plain
      if (this.databaseVersion >= 24) {
        const hash = createHash('sha256').update(host).digest()
        if (plain.length < hash.length || !timingSafeEqual(plain.subarray(0, hash.length), hash)) {
          throw new CookieImportError('decryption_failed')
        }
        value = plain.subarray(hash.length)
      }
      return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(value)
    } catch (error) {
      this.signal.throwIfAborted()
      throw error instanceof CookieImportError ? error : new CookieImportError('decryption_failed')
    } finally {
      plain?.fill(0)
    }
  }

  async dispose(): Promise<void> {
    for (const key of this.keys.values()) {
      try {
        ;(await key).fill(0)
      } catch {
        // Failed lookups are cached too, so a denied prompt is not repeated for every cookie.
      }
    }
    this.keys.clear()
  }
}
