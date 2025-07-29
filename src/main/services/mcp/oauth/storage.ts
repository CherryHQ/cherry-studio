import { loggerService } from '@logger'
import {
  OAuthClientInformation,
  OAuthClientInformationFull,
  OAuthTokens
} from '@modelcontextprotocol/sdk/shared/auth.js'
import fs from 'fs/promises'
import path from 'path'

import { IOAuthStorage, OAuthStorageData, OAuthStorageSchema } from './types'

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
      const data = await fs.readFile(this.filePath, 'utf-8')
      const parsed = JSON.parse(data)
      const validated = OAuthStorageSchema.parse(parsed)
      this.cache = validated
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
      await fs.writeFile(tempPath, JSON.stringify(data, null, 2))
      await fs.rename(tempPath, this.filePath)

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
