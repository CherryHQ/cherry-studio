import { randomUUID } from 'node:crypto'
import { chmodSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import * as z from 'zod'

const logger = loggerService.withContext('CherryAccountCredentialStore')

const sessionSchema = z
  .object({
    accountId: z.string().min(1),
    sessionId: z.string().min(1),
    refreshToken: z.string().min(1),
    sessionExpiresAt: z.number().int().positive(),
    deviceId: z.string().min(1),
    displayName: z.string().nullable()
  })
  .strict()

const credentialsSchema = z
  .object({
    version: z.literal(1),
    devicePublicKey: z.string().min(1),
    devicePrivateKey: z.string().min(1),
    session: sessionSchema.nullable()
  })
  .strict()

export type CherryAccountStoredSession = z.infer<typeof sessionSchema>
export type CherryAccountCredentials = z.infer<typeof credentialsSchema>

function credentialsPath(): string {
  return application.getPath('feature.cherry_account.credentials_file')
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

export class CherryAccountCredentialStore {
  get(): CherryAccountCredentials | null {
    const filePath = credentialsPath()
    let raw: string
    try {
      raw = readFileSync(filePath, 'utf8')
    } catch (error) {
      if (isMissingFileError(error)) return null
      logger.warn('Failed to read Cherry account credentials', error as Error)
      return null
    }

    try {
      const parsed = credentialsSchema.safeParse(JSON.parse(raw))
      if (parsed.success) return parsed.data
    } catch {
      // Malformed JSON is handled like any other invalid credential payload.
    }

    logger.warn('Cherry account credentials are invalid; removing the file')
    this.removeFile(filePath)
    return null
  }

  replace(credentials: CherryAccountCredentials): void {
    const filePath = credentialsPath()
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`
    const contents = `${JSON.stringify(credentials, null, 2)}\n`

    try {
      writeFileSync(temporaryPath, contents, { encoding: 'utf8', mode: 0o600 })
      chmodSync(temporaryPath, 0o600)
      renameSync(temporaryPath, filePath)
      chmodSync(filePath, 0o600)
    } finally {
      this.removeFile(temporaryPath)
    }
  }

  clearSession(): void {
    const credentials = this.get()
    if (!credentials?.session) return
    this.replace({ ...credentials, session: null })
  }

  private removeFile(filePath: string): void {
    try {
      unlinkSync(filePath)
    } catch (error) {
      if (!isMissingFileError(error))
        logger.warn(`Failed to remove Cherry account credentials file ${path.basename(filePath)}`, error as Error)
    }
  }
}

export const cherryAccountCredentialStore = new CherryAccountCredentialStore()
