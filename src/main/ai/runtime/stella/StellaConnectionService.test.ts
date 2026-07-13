import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getPath: vi.fn(),
  encryptionAvailable: vi.fn(),
  selectedStorageBackend: vi.fn(),
  encryptString: vi.fn(),
  decryptString: vi.fn()
}))

vi.mock('@application', () => ({ application: { getPath: mocks.getPath } }))
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: mocks.encryptionAvailable,
    getSelectedStorageBackend: mocks.selectedStorageBackend,
    encryptString: mocks.encryptString,
    decryptString: mocks.decryptString
  }
}))

const { StellaConnectionService, normalizeStellaEndpoint } = await import('./StellaConnectionService')

describe('StellaConnectionService', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'stella-connection-'))
    mocks.getPath.mockReturnValue(path.join(tempDir, 'connection.json'))
    mocks.encryptionAvailable.mockReturnValue(true)
    mocks.selectedStorageBackend.mockReturnValue('unknown')
    mocks.encryptString.mockImplementation((value: string) => Buffer.from(`encrypted:${value}`))
    mocks.decryptString.mockImplementation((value: Buffer) => value.toString().replace('encrypted:', ''))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('stores only encrypted PAT bytes and never exposes them through connection info', () => {
    const service = new StellaConnectionService()
    expect(service.configure('https://stella.example/', 'secret-pat')).toEqual({
      endpoint: 'https://stella.example',
      configured: true
    })
    expect(existsSync(mocks.getPath())).toBe(true)
    expect(service.getInfo()).toEqual({ endpoint: 'https://stella.example', configured: true })
    expect(service.getCredentials()).toEqual({ endpoint: 'https://stella.example', pat: 'secret-pat' })
  })

  it('fails closed when Electron secure storage is unavailable or plaintext-backed', () => {
    mocks.encryptionAvailable.mockReturnValue(false)
    expect(() => new StellaConnectionService().configure('https://stella.example', 'secret-pat')).toThrow(
      'Secure storage is unavailable'
    )

    mocks.encryptionAvailable.mockReturnValue(true)
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    mocks.selectedStorageBackend.mockReturnValue('basic_text')
    expect(() => new StellaConnectionService().configure('https://stella.example', 'secret-pat')).toThrow(
      'Secure storage is unavailable'
    )
  })

  it('rejects non-http endpoints, remote HTTP, endpoint credentials, and base paths', () => {
    expect(() => normalizeStellaEndpoint('file:///tmp/stella')).toThrow('HTTP or HTTPS')
    expect(() => normalizeStellaEndpoint('http://stella.example')).toThrow('use HTTPS')
    expect(() => normalizeStellaEndpoint('https://pat@example.com')).toThrow('must not contain credentials')
    expect(() => normalizeStellaEndpoint('https://stella.example/api')).toThrow('must not include a path')
    expect(normalizeStellaEndpoint('http://127.0.0.1:25678')).toBe('http://127.0.0.1:25678')
  })
})
