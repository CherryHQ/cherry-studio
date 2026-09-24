import fs from 'fs/promises'
import os from 'os'
import path from 'path'

import type { StoredOAuthClientInformation, StoredOAuthTokens } from '@modelcontextprotocol/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { JsonFileStorage, type OAuthSecretCipher } from '../storage'

const cipher: OAuthSecretCipher = {
  isAvailable: () => true,
  encrypt: (value) => Buffer.from(value).toString('base64'),
  decrypt: (value) => Buffer.from(value, 'base64').toString()
}

describe('JsonFileStorage round-trip', () => {
  let configDir: string
  const serverUrlHash = 'abc123hash'

  beforeEach(async () => {
    configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oauth-storage-test-'))
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await fs.rm(configDir, { recursive: true, force: true })
  })

  it('writes the file under <serverUrlHash>_oauth.json in the config dir', async () => {
    const storage = new JsonFileStorage(serverUrlHash, configDir, cipher)

    await storage.saveCodeVerifier('verifier-xyz')

    const filePath = path.join(configDir, `${serverUrlHash}_oauth.json`)
    await expect(fs.access(filePath)).resolves.toBeUndefined()
  })

  it('round-trips tokens through a fresh instance (no in-memory cache)', async () => {
    const tokens: StoredOAuthTokens = {
      access_token: 'access-token-value',
      token_type: 'Bearer',
      refresh_token: 'refresh-token-value',
      expires_in: 3600
    }

    const writer = new JsonFileStorage(serverUrlHash, configDir, cipher)
    await writer.saveTokens(tokens)

    // A new instance has an empty cache, so this read comes from disk.
    const reader = new JsonFileStorage(serverUrlHash, configDir, cipher)
    await expect(reader.getTokens()).resolves.toEqual(tokens)
  })

  it('preserves migrated credentials on the first read and subsequent writes', async () => {
    const tokens = { access_token: 'legacy-access', token_type: 'Bearer', refresh_token: 'legacy-refresh' }
    const clientInfo = { client_id: 'legacy-client', client_secret: 'legacy-secret' }
    const filePath = path.join(configDir, `${serverUrlHash}_oauth.json`)
    await fs.writeFile(
      filePath,
      JSON.stringify({ tokens, clientInfo, codeVerifier: 'legacy-verifier', lastUpdated: 1 })
    )

    const storage = new JsonFileStorage(serverUrlHash, configDir, cipher)
    await expect(storage.getTokens()).resolves.toEqual(tokens)
    await storage.saveState('next-state')

    const reader = new JsonFileStorage(serverUrlHash, configDir, cipher)
    await expect(reader.getTokens()).resolves.toEqual(tokens)
    await expect(reader.getClientInformation()).resolves.toEqual(clientInfo)
    await expect(reader.getCodeVerifier()).resolves.toBe('legacy-verifier')
    await expect(reader.getState()).resolves.toBe('next-state')
    const persisted = await fs.readFile(filePath, 'utf8')
    expect(persisted).not.toContain('legacy-access')
    expect(persisted).not.toContain('legacy-secret')
  })

  it('round-trips client information', async () => {
    const clientInfo: StoredOAuthClientInformation = {
      client_id: 'client-id-123',
      client_secret: 'client-secret-456'
    }

    const writer = new JsonFileStorage(serverUrlHash, configDir, cipher)
    await writer.saveClientInformation(clientInfo)

    const reader = new JsonFileStorage(serverUrlHash, configDir, cipher)
    await expect(reader.getClientInformation()).resolves.toEqual(clientInfo)
  })

  it('round-trips the code verifier', async () => {
    const writer = new JsonFileStorage(serverUrlHash, configDir, cipher)
    await writer.saveCodeVerifier('the-code-verifier')

    const reader = new JsonFileStorage(serverUrlHash, configDir, cipher)
    await expect(reader.getCodeVerifier()).resolves.toBe('the-code-verifier')
  })

  it('preserves earlier fields when a later field is saved', async () => {
    const storage = new JsonFileStorage(serverUrlHash, configDir, cipher)
    await storage.saveCodeVerifier('verifier-1')
    await storage.saveTokens({ access_token: 'tok', token_type: 'Bearer' })

    const reader = new JsonFileStorage(serverUrlHash, configDir, cipher)
    await expect(reader.getCodeVerifier()).resolves.toBe('verifier-1')
    await expect(reader.getTokens()).resolves.toEqual({ access_token: 'tok', token_type: 'Bearer' })
  })

  it('clear() removes stored data so a fresh instance reads empty state', async () => {
    const storage = new JsonFileStorage(serverUrlHash, configDir, cipher)
    await storage.saveTokens({ access_token: 'tok', token_type: 'Bearer' })

    await storage.clear()

    const reader = new JsonFileStorage(serverUrlHash, configDir, cipher)
    await expect(reader.getTokens()).resolves.toBeUndefined()
  })

  it('isolates tokens by authorization-server issuer', async () => {
    const storage = new JsonFileStorage(serverUrlHash, configDir, cipher)
    await storage.saveTokens(
      { access_token: 'issuer-a-token', token_type: 'Bearer', issuer: 'https://issuer-a' },
      { issuer: 'https://issuer-a' }
    )
    await storage.saveTokens(
      { access_token: 'issuer-b-token', token_type: 'Bearer', issuer: 'https://issuer-b' },
      { issuer: 'https://issuer-b' }
    )

    await expect(storage.getTokens({ issuer: 'https://issuer-a' })).resolves.toMatchObject({
      access_token: 'issuer-a-token'
    })
    await expect(storage.getTokens({ issuer: 'https://issuer-b' })).resolves.toMatchObject({
      access_token: 'issuer-b-token'
    })
  })

  it.each(['cached', 'fresh', 'legacy'])(
    'clears discovery without redundant writes or credential loss (%s)',
    async (mode) => {
      const tokens = { access_token: 'stored-access', token_type: 'Bearer' }
      const clientInfo = { client_id: 'stored-client', client_secret: 'stored-secret' }
      const discoveryState = { authorizationServerUrl: 'https://auth.example.com' }
      const filePath = path.join(configDir, `${serverUrlHash}_oauth.json`)
      const writer = new JsonFileStorage(serverUrlHash, configDir, cipher)
      if (mode === 'legacy') {
        await fs.writeFile(
          filePath,
          JSON.stringify({ tokens, clientInfo, codeVerifier: 'verifier', discoveryState, lastUpdated: 1 })
        )
      } else {
        await writer.saveTokens(tokens)
        await writer.saveClientInformation(clientInfo)
        await writer.saveCodeVerifier('verifier')
        await writer.saveDiscoveryState(discoveryState)
      }

      const storage = mode === 'fresh' ? new JsonFileStorage(serverUrlHash, configDir, cipher) : writer
      const writes = vi.spyOn(fs, 'writeFile')
      await storage.clear('discovery')
      expect(writes).toHaveBeenCalledTimes(mode === 'legacy' ? 2 : 1)

      const reader = new JsonFileStorage(serverUrlHash, configDir, cipher)
      await expect(reader.getDiscoveryState()).resolves.toBeUndefined()
      await expect(reader.getTokens()).resolves.toEqual(tokens)
      await expect(reader.getClientInformation()).resolves.toEqual(clientInfo)
      await expect(reader.getCodeVerifier()).resolves.toBe('verifier')
      const persisted = await fs.readFile(filePath, 'utf8')
      expect(persisted).not.toContain('stored-access')
      expect(persisted).not.toContain('stored-secret')
    }
  )

  it('does not write credentials in plaintext when encryption is unavailable', async () => {
    const unavailable: OAuthSecretCipher = {
      isAvailable: () => false,
      encrypt: () => {
        throw new Error('unexpected encrypt')
      },
      decrypt: () => {
        throw new Error('unexpected decrypt')
      }
    }
    const storage = new JsonFileStorage(serverUrlHash, configDir, unavailable)
    await storage.saveTokens({ access_token: 'plaintext-must-not-land', token_type: 'Bearer' })

    const file = await fs.readFile(path.join(configDir, `${serverUrlHash}_oauth.json`), 'utf8')
    expect(file).not.toContain('plaintext-must-not-land')
    await expect(storage.getTokens()).resolves.toMatchObject({ access_token: 'plaintext-must-not-land' })
  })
})
