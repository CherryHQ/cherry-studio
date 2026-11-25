import { randomUUID } from 'node:crypto'
import { chmodSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import * as z from 'zod'

import { application } from '@application'
import { loggerService } from '@logger'
import {
  decryptSecret,
  encryptSecret,
  isEncryptedSecret,
  tryDecryptSecret
} from '@main/services/security/secretStorage'

const logger = loggerService.withContext('CherryAccountCredentialStore')

const sessionSchema = z
  .object({
    apiOrigin: z.url().optional(),
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

function readCredentialFile(): string | null {
  try {
    return readFileSync(credentialsPath(), 'utf8')
  } catch (error) {
    if (isMissingFileError(error)) return null
    throw error
  }
}

function removeCredentialFile(filePath: string): void {
  try {
    unlinkSync(filePath)
  } catch (error) {
    if (!isMissingFileError(error))
      logger.warn(`Failed to remove Cherry account credentials file ${path.basename(filePath)}`, error as Error)
  }
}

function writeCredentialFile(contents: string): void {
  const filePath = credentialsPath()
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporaryPath, contents, { encoding: 'utf8', mode: 0o600, flag: 'wx', flush: true })
    chmodSync(temporaryPath, 0o600)
    renameSync(temporaryPath, filePath)
  } finally {
    removeCredentialFile(temporaryPath)
  }
}

export class CherryAccountCredentialStore {
  get(): CherryAccountCredentials | null {
    let raw: string | null
    try {
      raw = readCredentialFile()
    } catch (error) {
      logger.warn('Failed to read Cherry account credentials', error as Error)
      return null
    }
    if (raw === null) return null

    const payload = tryDecryptSecret(raw)
    if (payload === undefined) {
      // Keep ciphertext for a future run where the OS keyring is available.
      logger.warn('Cherry account credentials could not be decrypted; keeping the file')
      return null
    }

    try {
      const parsed = credentialsSchema.safeParse(JSON.parse(payload))
      if (parsed.success) {
        // Seal a legacy plaintext file on first read.
        const sealed = encryptSecret(raw)
        if (sealed !== raw) {
          try {
            writeCredentialFile(sealed)
          } catch (error) {
            logger.warn('Could not encrypt the existing Cherry account file', error as Error)
          }
        }
        return parsed.data
      }
    } catch {
      // Malformed JSON is handled like any other invalid credential payload.
    }

    logger.warn('Cherry account credentials are invalid')
    if (!isEncryptedSecret(raw)) removeCredentialFile(credentialsPath())
    return null
  }

  replace(credentials: CherryAccountCredentials): void {
    const existing = readCredentialFile()
    if (isEncryptedSecret(existing)) decryptSecret(existing)
    const contents = encryptSecret(`${JSON.stringify(credentials, null, 2)}\n`)
    writeCredentialFile(contents)
  }

  clearSession(): void {
    const credentials = this.get()
    if (!credentials?.session) return
    this.replace({ ...credentials, session: null })
  }
}

export const cherryAccountCredentialStore = new CherryAccountCredentialStore()
