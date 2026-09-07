import { loggerService } from '@logger'
import type {
  OAuthClientInformationContext,
  OAuthDiscoveryState,
  StoredOAuthClientInformation,
  StoredOAuthTokens
} from '@modelcontextprotocol/client'
import { safeStorage } from 'electron'
import fs from 'fs/promises'
import path from 'path'

import type { IOAuthStorage, OAuthSecretData, OAuthStorageData } from './types'
import { LegacyOAuthStorageSchema, OAuthSecretDataSchema, OAuthStorageSchema } from './types'

const logger = loggerService.withContext('Mcp:OAuthStorage')
const LEGACY_ISSUER = 'legacy'
const volatileSecrets = new Map<string, OAuthSecretData>()

export interface OAuthSecretCipher {
  isAvailable(): boolean
  encrypt(value: string): string
  decrypt(value: string): string
}

const electronSecretCipher: OAuthSecretCipher = {
  isAvailable: () => safeStorage.isEncryptionAvailable(),
  encrypt: (value) => safeStorage.encryptString(value).toString('base64'),
  decrypt: (value) => safeStorage.decryptString(Buffer.from(value, 'base64'))
}

function emptySecretData(): OAuthSecretData {
  return {
    clientInfoByIssuer: {},
    tokensByIssuer: {}
  }
}

export class JsonFileStorage implements IOAuthStorage {
  private readonly filePath: string
  private readonly cipher: OAuthSecretCipher
  private cache: OAuthStorageData | null = null
  private secretCache: OAuthSecretData | null = null

  constructor(
    readonly serverUrlHash: string,
    configDir: string,
    cipher: OAuthSecretCipher = electronSecretCipher
  ) {
    this.filePath = path.join(configDir, `${serverUrlHash}_oauth.json`)
    this.cipher = cipher
  }

  private issuerKey(ctx?: OAuthClientInformationContext, valueIssuer?: string): string {
    return ctx?.issuer ?? valueIssuer ?? this.secretCache?.lastIssuer ?? LEGACY_ISSUER
  }

  private async readStorage(): Promise<OAuthStorageData> {
    if (this.cache) {
      return this.cache
    }

    try {
      const raw: unknown = JSON.parse(await fs.readFile(this.filePath, 'utf-8'))
      const validated = OAuthStorageSchema.parse(raw)
      const legacy = LegacyOAuthStorageSchema.parse(raw)
      this.cache = validated

      if (legacy.clientInfo || legacy.tokens || legacy.codeVerifier) {
        const migrated = emptySecretData()
        if (legacy.clientInfo) {
          const issuer = legacy.clientInfo.issuer ?? LEGACY_ISSUER
          migrated.clientInfoByIssuer[issuer] = legacy.clientInfo
          migrated.lastIssuer = issuer
        }
        if (legacy.tokens) {
          const issuer = legacy.tokens.issuer ?? migrated.lastIssuer ?? LEGACY_ISSUER
          migrated.tokensByIssuer[issuer] = legacy.tokens
          migrated.lastIssuer = issuer
        }
        migrated.codeVerifier = legacy.codeVerifier
        this.secretCache = migrated
        await this.writeStorage(validated)
      }

      return validated
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        const initial: OAuthStorageData = { lastUpdated: Date.now() }
        await this.writeStorage(initial)
        return initial
      }
      logger.error('Error reading OAuth storage:', error as Error)
      throw new Error(`Failed to read OAuth storage: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private async readSecrets(): Promise<OAuthSecretData> {
    if (this.secretCache) {
      return this.secretCache
    }

    const data = await this.readStorage()
    if (data.encryptedCredentials && this.cipher.isAvailable()) {
      try {
        const decrypted: unknown = JSON.parse(this.cipher.decrypt(data.encryptedCredentials))
        this.secretCache = OAuthSecretDataSchema.parse(decrypted)
        return this.secretCache
      } catch (error) {
        logger.error('Failed to decrypt OAuth credentials; reauthorization is required', error as Error)
      }
    }

    this.secretCache = volatileSecrets.get(this.filePath) ?? emptySecretData()
    return this.secretCache
  }

  private async writeStorage(data: OAuthStorageData): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true })

      const nextData: OAuthStorageData = {
        ...data,
        lastUpdated: Date.now()
      }
      if (this.secretCache) {
        if (this.cipher.isAvailable()) {
          nextData.encryptedCredentials = this.cipher.encrypt(JSON.stringify(this.secretCache))
          volatileSecrets.delete(this.filePath)
        } else {
          delete nextData.encryptedCredentials
          volatileSecrets.set(this.filePath, this.secretCache)
          logger.warn('Secure credential storage is unavailable; OAuth credentials will be kept in memory only')
        }
      }

      const tempPath = `${this.filePath}.tmp`
      await fs.writeFile(tempPath, JSON.stringify(nextData, null, 2))
      await fs.rename(tempPath, this.filePath)
      this.cache = nextData
    } catch (error) {
      logger.error('Error writing OAuth storage:', error as Error)
      throw new Error(`Failed to write OAuth storage: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private async writeSecrets(secrets: OAuthSecretData): Promise<void> {
    this.secretCache = secrets
    await this.writeStorage(await this.readStorage())
  }

  async getClientInformation(ctx?: OAuthClientInformationContext): Promise<StoredOAuthClientInformation | undefined> {
    const secrets = await this.readSecrets()
    return secrets.clientInfoByIssuer[this.issuerKey(ctx)]
  }

  async saveClientInformation(
    info: StoredOAuthClientInformation | undefined,
    ctx?: OAuthClientInformationContext
  ): Promise<void> {
    const secrets = await this.readSecrets()
    const issuer = this.issuerKey(ctx, info?.issuer)
    if (info) {
      secrets.clientInfoByIssuer[issuer] = { ...info }
      secrets.lastIssuer = issuer
    } else {
      delete secrets.clientInfoByIssuer[issuer]
    }
    await this.writeSecrets(secrets)
  }

  async getTokens(ctx?: OAuthClientInformationContext): Promise<StoredOAuthTokens | undefined> {
    const secrets = await this.readSecrets()
    return secrets.tokensByIssuer[this.issuerKey(ctx)]
  }

  async saveTokens(tokens: StoredOAuthTokens | undefined, ctx?: OAuthClientInformationContext): Promise<void> {
    const secrets = await this.readSecrets()
    const issuer = this.issuerKey(ctx, tokens?.issuer)
    if (tokens) {
      secrets.tokensByIssuer[issuer] = { ...tokens }
      secrets.lastIssuer = issuer
    } else {
      delete secrets.tokensByIssuer[issuer]
    }
    await this.writeSecrets(secrets)
  }

  async getCodeVerifier(): Promise<string> {
    const verifier = (await this.readSecrets()).codeVerifier
    if (!verifier) {
      throw new Error('No code verifier saved for session')
    }
    return verifier
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    const secrets = await this.readSecrets()
    secrets.codeVerifier = codeVerifier || undefined
    await this.writeSecrets(secrets)
  }

  async getState(): Promise<string | undefined> {
    return (await this.readSecrets()).state
  }

  async saveState(state: string | undefined): Promise<void> {
    const secrets = await this.readSecrets()
    secrets.state = state
    await this.writeSecrets(secrets)
  }

  async getDiscoveryState(): Promise<OAuthDiscoveryState | undefined> {
    return (await this.readStorage()).discoveryState
  }

  async saveDiscoveryState(discoveryState: OAuthDiscoveryState | undefined): Promise<void> {
    await this.writeStorage({
      ...(await this.readStorage()),
      discoveryState
    })
  }

  async clear(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery' = 'all'): Promise<void> {
    const data = await this.readStorage()
    const secrets = await this.readSecrets()

    if (scope === 'all') {
      this.secretCache = emptySecretData()
      volatileSecrets.delete(this.filePath)
      await this.writeStorage({ lastUpdated: Date.now() })
      return
    }

    if (scope === 'client') {
      secrets.clientInfoByIssuer = {}
    } else if (scope === 'tokens') {
      secrets.tokensByIssuer = {}
    } else if (scope === 'verifier') {
      secrets.codeVerifier = undefined
    } else if (scope === 'discovery') {
      data.discoveryState = undefined
    }
    await this.writeSecrets(secrets)
    if (scope === 'discovery') {
      await this.writeStorage(data)
    }
  }
}
