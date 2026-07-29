import type { StoredOAuthClientInformation, StoredOAuthTokens } from '@modelcontextprotocol/client'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

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
