import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ExternalKnowledgeCredentialStore, type SafeStorageAdapter } from '../ExternalKnowledgeCredentialStore'

const secretValues = ['app-secret-sentinel', 'access-token-sentinel', 'refresh-token-sentinel']

function createSafeStorage(): SafeStorageAdapter {
  return {
    isEncryptionAvailable: vi.fn(() => true),
    getSelectedStorageBackend: vi.fn(() => 'gnome_libsecret' as const),
    encryptString: vi.fn((value: string) => Buffer.from(`sealed:${value}`, 'utf8')),
    decryptString: vi.fn((value: Buffer) => {
      const decoded = value.toString('utf8')
      if (!decoded.startsWith('sealed:')) throw new Error('decrypt failed with sensitive provider detail')
      return decoded.slice('sealed:'.length)
    })
  }
}

describe('ExternalKnowledgeCredentialStore', () => {
  let directory: string
  let filePath: string

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'cherry-external-credential-'))
    filePath = path.join(directory, 'Credentials', 'external-knowledge.json')
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('encrypts every secret and atomically writes a 0600 versioned file', async () => {
    const safeStorage = createSafeStorage()
    const store = new ExternalKnowledgeCredentialStore({ filePath, safeStorage })

    await store.put('credential-ref', {
      appId: 'cli_test',
      appSecret: secretValues[0],
      accessToken: secretValues[1],
      refreshToken: secretValues[2],
      accessTokenExpiresAt: 123_000,
      refreshTokenExpiresAt: 456_000,
      grantedScopes: ['wiki:node:read', 'offline_access']
    })

    const contents = await readFile(filePath, 'utf8')
    for (const secret of secretValues) expect(contents).not.toContain(secret)
    expect(JSON.parse(contents)).toMatchObject({ version: 1, entries: { 'credential-ref': { appId: 'cli_test' } } })
    expect((await stat(filePath)).mode & 0o777).toBe(0o600)
    expect((await readdir(path.dirname(filePath))).filter((name) => name.endsWith('.tmp'))).toEqual([])

    await expect(store.read('credential-ref')).resolves.toEqual({
      status: 'ok',
      credential: {
        appId: 'cli_test',
        appSecret: secretValues[0],
        accessToken: secretValues[1],
        refreshToken: secretValues[2],
        accessTokenExpiresAt: 123_000,
        refreshTokenExpiresAt: 456_000,
        grantedScopes: ['wiki:node:read', 'offline_access']
      }
    })
  })

  it('reports a strict-schema corruption without deleting the file', async () => {
    const store = new ExternalKnowledgeCredentialStore({ filePath, safeStorage: createSafeStorage() })
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, JSON.stringify({ version: 1, entries: {}, unexpected: secretValues[0] }), { mode: 0o600 })

    const result = await store.read('credential-ref')

    expect(result).toEqual({ status: 'corrupt' })
    expect(await readFile(filePath, 'utf8')).toContain('unexpected')
  })

  it('reports missing and undecryptable credentials without exposing the cause', async () => {
    const safeStorage = createSafeStorage()
    const store = new ExternalKnowledgeCredentialStore({ filePath, safeStorage })
    await expect(store.read('missing')).resolves.toEqual({ status: 'missing' })

    await store.put('credential-ref', {
      appId: 'cli_test',
      appSecret: secretValues[0],
      grantedScopes: []
    })
    vi.mocked(safeStorage.decryptString).mockImplementation(() => {
      throw new Error(`cannot decrypt ${secretValues[0]}`)
    })

    const result = await store.read('credential-ref')
    expect(result).toEqual({ status: 'undecryptable' })
    expect(JSON.stringify(result)).not.toContain(secretValues[0])
  })

  it('rotates a refresh token once and rejects a stale second result', async () => {
    const store = new ExternalKnowledgeCredentialStore({ filePath, safeStorage: createSafeStorage() })
    await store.put('credential-ref', {
      appId: 'cli_test',
      appSecret: secretValues[0],
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      accessTokenExpiresAt: 100,
      refreshTokenExpiresAt: 200,
      grantedScopes: ['offline_access']
    })

    await expect(
      store.rotateTokens('credential-ref', 'refresh-1', {
        accessToken: 'access-2',
        refreshToken: 'refresh-2',
        accessTokenExpiresAt: 300,
        refreshTokenExpiresAt: 400,
        grantedScopes: ['offline_access']
      })
    ).resolves.toBe('updated')
    await expect(
      store.rotateTokens('credential-ref', 'refresh-1', {
        accessToken: 'stale-access',
        refreshToken: 'stale-refresh',
        accessTokenExpiresAt: 500,
        refreshTokenExpiresAt: 600,
        grantedScopes: ['offline_access']
      })
    ).resolves.toBe('stale')

    const result = await store.read('credential-ref')
    expect(result.status === 'ok' && result.credential.refreshToken).toBe('refresh-2')
  })

  it('serializes concurrent file mutations so different credentials are not lost', async () => {
    const store = new ExternalKnowledgeCredentialStore({ filePath, safeStorage: createSafeStorage() })

    await Promise.all([
      store.put('credential-one', { appId: 'cli_one', appSecret: 'secret-one', grantedScopes: [] }),
      store.put('credential-two', { appId: 'cli_two', appSecret: 'secret-two', grantedScopes: [] })
    ])

    await expect(store.read('credential-one')).resolves.toMatchObject({
      status: 'ok',
      credential: { appId: 'cli_one' }
    })
    await expect(store.read('credential-two')).resolves.toMatchObject({
      status: 'ok',
      credential: { appId: 'cli_two' }
    })
  })

  it('enumerates credential references only from a valid decryptable file', async () => {
    const safeStorage = createSafeStorage()
    const store = new ExternalKnowledgeCredentialStore({ filePath, safeStorage })

    await expect(store.listReferences()).resolves.toEqual({ status: 'missing' })
    await store.put('credential-one', { appId: 'cli_one', appSecret: 'secret-one', grantedScopes: [] })
    await store.put('credential-two', { appId: 'cli_two', appSecret: 'secret-two', grantedScopes: [] })
    await expect(store.listReferences()).resolves.toEqual({
      status: 'ok',
      credentialReferences: expect.arrayContaining(['credential-one', 'credential-two'])
    })

    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false)
    await expect(store.listReferences()).resolves.toEqual({ status: 'undecryptable' })
  })

  it('does not rewrite a corrupt file while attempting to enumerate references', async () => {
    const store = new ExternalKnowledgeCredentialStore({ filePath, safeStorage: createSafeStorage() })
    await mkdir(path.dirname(filePath), { recursive: true })
    const corruptContents = JSON.stringify({ version: 1, entries: {}, unexpected: secretValues[0] })
    await writeFile(filePath, corruptContents, { mode: 0o600 })

    await expect(store.listReferences()).resolves.toEqual({ status: 'corrupt' })
    await expect(readFile(filePath, 'utf8')).resolves.toBe(corruptContents)
  })

  it('probes encryption availability synchronously before starting authorization', () => {
    const safeStorage = createSafeStorage()
    const store = new ExternalKnowledgeCredentialStore({ filePath, safeStorage })

    expect(() => store.assertAvailable()).not.toThrow()
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false)
    expect(() => store.assertAvailable()).toThrowError(
      expect.objectContaining({
        code: 'encryption-unavailable',
        message: 'Knowledge credential storage is unavailable'
      })
    )
  })

  it('fails closed when platform encryption is unavailable', async () => {
    const safeStorage = createSafeStorage()
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false)
    const store = new ExternalKnowledgeCredentialStore({ filePath, safeStorage })

    const error = await store
      .put('credential-ref', { appId: 'cli_test', appSecret: secretValues[0], grantedScopes: [] })
      .catch((cause: unknown) => cause)

    expect(error).toMatchObject({
      code: 'encryption-unavailable',
      message: 'Knowledge credential storage is unavailable'
    })
    expect(JSON.stringify(error)).not.toContain(secretValues[0])
  })

  it('fails closed for the Linux basic_text safeStorage backend', async () => {
    const originalPlatform = process.platform
    const safeStorage = createSafeStorage()
    vi.mocked(safeStorage.getSelectedStorageBackend).mockReturnValue('basic_text')
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    const store = new ExternalKnowledgeCredentialStore({ filePath, safeStorage })

    try {
      expect(() => store.assertAvailable()).toThrowError(expect.objectContaining({ code: 'encryption-unavailable' }))
      await expect(
        store.put('credential-ref', { appId: 'cli_test', appSecret: secretValues[0], grantedScopes: [] })
      ).rejects.toMatchObject({ code: 'encryption-unavailable' })
      expect(safeStorage.encryptString).not.toHaveBeenCalled()
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
    }
  })

  it('does not decrypt or rotate credentials after Linux safeStorage falls back to basic_text', async () => {
    const originalPlatform = process.platform
    const safeStorage = createSafeStorage()
    const store = new ExternalKnowledgeCredentialStore({ filePath, safeStorage })
    await store.put('credential-ref', {
      appId: 'cli_test',
      appSecret: secretValues[0],
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      accessTokenExpiresAt: 100,
      refreshTokenExpiresAt: 200,
      grantedScopes: ['offline_access']
    })
    vi.mocked(safeStorage.decryptString).mockClear()
    vi.mocked(safeStorage.getSelectedStorageBackend).mockReturnValue('basic_text')
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })

    try {
      await expect(store.read('credential-ref')).resolves.toEqual({ status: 'undecryptable' })
      await expect(
        store.rotateTokens('credential-ref', 'refresh-1', {
          accessToken: 'access-2',
          refreshToken: 'refresh-2',
          accessTokenExpiresAt: 300,
          refreshTokenExpiresAt: 400,
          grantedScopes: ['offline_access']
        })
      ).resolves.toBe('undecryptable')
      expect(safeStorage.decryptString).not.toHaveBeenCalled()
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
    }
  })
})
