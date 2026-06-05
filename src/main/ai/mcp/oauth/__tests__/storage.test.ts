import type { OAuthClientInformation, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { JsonFileStorage } from '../storage'

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
    const storage = new JsonFileStorage(serverUrlHash, configDir)

    await storage.saveCodeVerifier('verifier-xyz')

    const filePath = path.join(configDir, `${serverUrlHash}_oauth.json`)
    await expect(fs.access(filePath)).resolves.toBeUndefined()
  })

  it('round-trips tokens through a fresh instance (no in-memory cache)', async () => {
    const tokens: OAuthTokens = {
      access_token: 'access-token-value',
      token_type: 'Bearer',
      refresh_token: 'refresh-token-value',
      expires_in: 3600
    }

    const writer = new JsonFileStorage(serverUrlHash, configDir)
    await writer.saveTokens(tokens)

    // A new instance has an empty cache, so this read comes from disk.
    const reader = new JsonFileStorage(serverUrlHash, configDir)
    await expect(reader.getTokens()).resolves.toEqual(tokens)
  })

  it('round-trips client information', async () => {
    const clientInfo: OAuthClientInformation = {
      client_id: 'client-id-123',
      client_secret: 'client-secret-456'
    }

    const writer = new JsonFileStorage(serverUrlHash, configDir)
    await writer.saveClientInformation(clientInfo)

    const reader = new JsonFileStorage(serverUrlHash, configDir)
    await expect(reader.getClientInformation()).resolves.toEqual(clientInfo)
  })

  it('round-trips the code verifier', async () => {
    const writer = new JsonFileStorage(serverUrlHash, configDir)
    await writer.saveCodeVerifier('the-code-verifier')

    const reader = new JsonFileStorage(serverUrlHash, configDir)
    await expect(reader.getCodeVerifier()).resolves.toBe('the-code-verifier')
  })

  it('preserves earlier fields when a later field is saved', async () => {
    const storage = new JsonFileStorage(serverUrlHash, configDir)
    await storage.saveCodeVerifier('verifier-1')
    await storage.saveTokens({ access_token: 'tok', token_type: 'Bearer' })

    const reader = new JsonFileStorage(serverUrlHash, configDir)
    await expect(reader.getCodeVerifier()).resolves.toBe('verifier-1')
    await expect(reader.getTokens()).resolves.toEqual({ access_token: 'tok', token_type: 'Bearer' })
  })

  it('clear() removes stored data so a fresh instance reads empty state', async () => {
    const storage = new JsonFileStorage(serverUrlHash, configDir)
    await storage.saveTokens({ access_token: 'tok', token_type: 'Bearer' })

    await storage.clear()

    const reader = new JsonFileStorage(serverUrlHash, configDir)
    await expect(reader.getTokens()).resolves.toBeUndefined()
  })
})
