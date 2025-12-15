import { loggerService } from '@logger'
import type {
  OAuthClientInformation,
  OAuthClientInformationFull,
  OAuthTokens
} from '@modelcontextprotocol/sdk/shared/auth.js'
import { safeStorage } from 'electron'
import fs from 'fs/promises'
import path from 'path'

import type { IOAuthStorage, OAuthStorageData } from './types'
import { OAuthStorageSchema } from './types'

const logger = loggerService.withContext('MCP:OAuthStorage')

export class JsonFileStorage implements IOAuthStorage {
  private readonly filePath: string
  private cache: OAuthStorageData | null = null

  constructor(
    readonly serverUrlHash: string,
    configDir: string
  ) {
    this.filePath = path.join(configDir, `${serverUrlHash}_oauth.json`)
  }

  private async readStorage(): Promise<OAuthStorageData> {
    if (this.cache) {
      return this.cache
    }

    try {
      const raw = await fs.readFile(this.filePath)

      let storageJson: string | undefined
      let usedEncryptedPayload = false

      if (safeStorage.isEncryptionAvailable()) {
        try {
          storageJson = safeStorage.decryptString(raw)
          usedEncryptedPayload = true
        } catch {
          // Fall back to legacy plain JSON (pre-encryption), and migrate on success.
        }
      }

      if (storageJson === undefined) {
        storageJson = raw.toString('utf-8')
      }

      const parsed = JSON.parse(storageJson)
      const validated = OAuthStorageSchema.parse(parsed)
      this.cache = validated

      if (safeStorage.isEncryptionAvailable() && !usedEncryptedPayload) {
        await this.writeStorage(validated)
      }

      return validated
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        // File doesn't exist, return initial state
        const initial: OAuthStorageData = { lastUpdated: Date.now() }
        await this.writeStorage(initial)
        return initial
      }
      logger.error('Error reading OAuth storage:', error as Error)
      throw new Error(`Failed to read OAuth storage: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private async writeStorage(data: OAuthStorageData): Promise<void> {
    try {
      // Ensure directory exists
      await fs.mkdir(path.dirname(this.filePath), { recursive: true })

      // Update timestamp
      data.lastUpdated = Date.now()

      // Write file atomically
      const tempPath = `${this.filePath}.tmp`
      const payload = JSON.stringify(data, null, 2)
      if (safeStorage.isEncryptionAvailable()) {
        await fs.writeFile(tempPath, safeStorage.encryptString(payload))
      } else {
        logger.warn('safeStorage encryption is not available; saving MCP OAuth storage as plain JSON')
        await fs.writeFile(tempPath, payload)
      }
      await fs.rename(tempPath, this.filePath)
      await fs.chmod(this.filePath, 0o600)

      // Update cache
      this.cache = data
    } catch (error) {
      logger.error('Error writing OAuth storage:', error as Error)
      throw new Error(`Failed to write OAuth storage: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async getClientInformation(): Promise<OAuthClientInformation | undefined> {
    const data = await this.readStorage()
    return data.clientInfo
  }

  async saveClientInformation(info: OAuthClientInformationFull): Promise<void> {
    const data = await this.readStorage()
    await this.writeStorage({
      ...data,
      clientInfo: info
    })
  }

  async getTokens(): Promise<OAuthTokens | undefined> {
    const data = await this.readStorage()
    return data.tokens
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    const data = await this.readStorage()
    await this.writeStorage({
      ...data,
      tokens
    })
  }

  async getCodeVerifier(): Promise<string> {
    const data = await this.readStorage()
    if (!data.codeVerifier) {
      throw new Error('No code verifier saved for session')
    }
    return data.codeVerifier
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    const data = await this.readStorage()
    await this.writeStorage({
      ...data,
      codeVerifier
    })
  }

  async clear(): Promise<void> {
    try {
      await fs.unlink(this.filePath)
      this.cache = null
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code !== 'ENOENT') {
        logger.error('Error clearing OAuth storage:', error as Error)
        throw new Error(`Failed to clear OAuth storage: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
}
