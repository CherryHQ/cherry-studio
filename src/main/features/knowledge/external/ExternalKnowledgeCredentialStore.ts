import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import { safeStorage } from 'electron'
import * as z from 'zod'

import { application } from '@application'
import { atomicWriteFile } from '@main/utils/file'
import { AbsoluteFilePathSchema } from '@shared/types/file'

const encryptedValueSchema = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9+/]+={0,2}$/)
const encryptedCredentialSchema = z
  .object({
    appId: z.string().trim().min(1),
    appSecret: encryptedValueSchema,
    accessToken: encryptedValueSchema.nullable(),
    refreshToken: encryptedValueSchema.nullable(),
    accessTokenExpiresAt: z.number().int().positive().nullable(),
    refreshTokenExpiresAt: z.number().int().positive().nullable(),
    grantedScopes: z.array(z.string().trim().min(1))
  })
  .strict()

const credentialFileSchema = z
  .object({
    version: z.literal(1),
    entries: z.record(z.string().trim().min(1), encryptedCredentialSchema)
  })
  .strict()

type CredentialFile = z.infer<typeof credentialFileSchema>
type EncryptedCredential = z.infer<typeof encryptedCredentialSchema>

export type ExternalKnowledgeCredential = {
  appId: string
  appSecret: string
  accessToken?: string
  refreshToken?: string
  accessTokenExpiresAt?: number
  refreshTokenExpiresAt?: number
  grantedScopes: string[]
}

export type ExternalKnowledgeTokenSet = {
  accessToken: string
  refreshToken: string
  accessTokenExpiresAt: number
  refreshTokenExpiresAt: number
  grantedScopes: string[]
}

export type ExternalKnowledgeCredentialReadResult =
  | { status: 'ok'; credential: ExternalKnowledgeCredential }
  | { status: 'missing' | 'corrupt' | 'undecryptable' }

export type ExternalKnowledgeCredentialReferenceListResult =
  | { status: 'ok'; credentialReferences: string[] }
  | { status: 'missing' | 'corrupt' | 'undecryptable' }

export type TokenRotationResult = 'updated' | 'missing' | 'stale' | 'corrupt' | 'undecryptable'

export type SafeStorageAdapter = Pick<
  typeof safeStorage,
  'isEncryptionAvailable' | 'getSelectedStorageBackend' | 'encryptString' | 'decryptString'
>

const electronSafeStorage: SafeStorageAdapter = {
  isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
  getSelectedStorageBackend: () => safeStorage.getSelectedStorageBackend(),
  encryptString: (value) => safeStorage.encryptString(value),
  decryptString: (value) => safeStorage.decryptString(value)
}

const LINUX_SECURE_STORAGE_BACKENDS = new Set(['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'])

export class ExternalKnowledgeCredentialStoreError extends Error {
  constructor(
    readonly code: 'encryption-unavailable' | 'corrupt' | 'write-failed',
    message: string
  ) {
    super(message)
    this.name = 'ExternalKnowledgeCredentialStoreError'
  }
}

type StoreOptions = {
  filePath?: string
  safeStorage?: SafeStorageAdapter
}

type FileReadResult = { status: 'ok'; file: CredentialFile } | { status: 'missing' | 'corrupt' }

export class ExternalKnowledgeCredentialStore {
  private readonly configuredFilePath?: string
  private readonly encryption: SafeStorageAdapter
  private mutationTail: Promise<void> = Promise.resolve()

  constructor(options: StoreOptions = {}) {
    this.configuredFilePath = options.filePath
    this.encryption = options.safeStorage ?? electronSafeStorage
  }

  async read(credentialReference: string): Promise<ExternalKnowledgeCredentialReadResult> {
    const result = await this.readFile()
    if (result.status !== 'ok') return result

    const entry = result.file.entries[credentialReference]
    if (!entry) return { status: 'missing' }
    if (!this.isEncryptionAvailable()) return { status: 'undecryptable' }

    try {
      return { status: 'ok', credential: this.decrypt(entry) }
    } catch {
      return { status: 'undecryptable' }
    }
  }

  assertAvailable(): void {
    if (!this.isEncryptionAvailable()) {
      throw new ExternalKnowledgeCredentialStoreError(
        'encryption-unavailable',
        'Knowledge credential storage is unavailable'
      )
    }
  }

  async listReferences(): Promise<ExternalKnowledgeCredentialReferenceListResult> {
    const current = await this.readFile()
    if (current.status !== 'ok') return current
    if (!this.isEncryptionAvailable()) return { status: 'undecryptable' }
    return { status: 'ok', credentialReferences: Object.keys(current.file.entries) }
  }

  async put(credentialReference: string, credential: ExternalKnowledgeCredential): Promise<void> {
    await this.mutate(async () => {
      this.assertAvailable()
      const current = await this.readFile()
      if (current.status === 'corrupt') {
        throw new ExternalKnowledgeCredentialStoreError('corrupt', 'Knowledge credential storage is corrupt')
      }

      try {
        const file = current.status === 'ok' ? current.file : { version: 1 as const, entries: {} }
        await this.replace({
          ...file,
          entries: { ...file.entries, [credentialReference]: this.encrypt(credential) }
        })
      } catch (error) {
        if (error instanceof ExternalKnowledgeCredentialStoreError) throw error
        throw new ExternalKnowledgeCredentialStoreError(
          'write-failed',
          'Knowledge credential storage could not be updated'
        )
      }
    })
  }

  async rotateTokens(
    credentialReference: string,
    expectedRefreshToken: string,
    tokens: ExternalKnowledgeTokenSet
  ): Promise<TokenRotationResult> {
    return await this.mutate(async () => {
      const current = await this.readFile()
      if (current.status !== 'ok') return current.status
      const entry = current.file.entries[credentialReference]
      if (!entry) return 'missing'
      if (!this.isEncryptionAvailable()) return 'undecryptable'

      try {
        if (!entry.refreshToken || this.decryptValue(entry.refreshToken) !== expectedRefreshToken) return 'stale'
      } catch {
        return 'undecryptable'
      }

      const updated: EncryptedCredential = {
        ...entry,
        accessToken: this.encryptValue(tokens.accessToken),
        refreshToken: this.encryptValue(tokens.refreshToken),
        accessTokenExpiresAt: tokens.accessTokenExpiresAt,
        refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
        grantedScopes: tokens.grantedScopes
      }
      try {
        await this.replace({
          ...current.file,
          entries: { ...current.file.entries, [credentialReference]: updated }
        })
      } catch {
        throw new ExternalKnowledgeCredentialStoreError(
          'write-failed',
          'Knowledge credential storage could not be updated'
        )
      }
      return 'updated'
    })
  }

  async remove(credentialReference: string): Promise<void> {
    await this.mutate(async () => {
      const current = await this.readFile()
      if (current.status !== 'ok') {
        if (current.status === 'missing') return
        throw new ExternalKnowledgeCredentialStoreError('corrupt', 'Knowledge credential storage is corrupt')
      }
      if (!(credentialReference in current.file.entries)) return
      this.assertAvailable()

      const entries = { ...current.file.entries }
      delete entries[credentialReference]
      try {
        await this.replace({ ...current.file, entries })
      } catch {
        throw new ExternalKnowledgeCredentialStoreError(
          'write-failed',
          'Knowledge credential storage could not be updated'
        )
      }
    })
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(operation, operation)
    this.mutationTail = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  private get filePath(): string {
    return this.configuredFilePath ?? application.getPath('feature.knowledge.credentials_file')
  }

  private async readFile(): Promise<FileReadResult> {
    let raw: string
    try {
      raw = await readFile(this.filePath, 'utf8')
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return { status: 'missing' }
      return { status: 'corrupt' }
    }

    try {
      const parsed = credentialFileSchema.safeParse(JSON.parse(raw))
      return parsed.success ? { status: 'ok', file: parsed.data } : { status: 'corrupt' }
    } catch {
      return { status: 'corrupt' }
    }
  }

  private encrypt(credential: ExternalKnowledgeCredential): EncryptedCredential {
    return {
      appId: credential.appId,
      appSecret: this.encryptValue(credential.appSecret),
      accessToken: credential.accessToken ? this.encryptValue(credential.accessToken) : null,
      refreshToken: credential.refreshToken ? this.encryptValue(credential.refreshToken) : null,
      accessTokenExpiresAt: credential.accessTokenExpiresAt ?? null,
      refreshTokenExpiresAt: credential.refreshTokenExpiresAt ?? null,
      grantedScopes: credential.grantedScopes
    }
  }

  private decrypt(credential: EncryptedCredential): ExternalKnowledgeCredential {
    const accessToken = credential.accessToken ? this.decryptValue(credential.accessToken) : undefined
    const refreshToken = credential.refreshToken ? this.decryptValue(credential.refreshToken) : undefined
    return {
      appId: credential.appId,
      appSecret: this.decryptValue(credential.appSecret),
      ...(accessToken && { accessToken }),
      ...(refreshToken && { refreshToken }),
      ...(credential.accessTokenExpiresAt && { accessTokenExpiresAt: credential.accessTokenExpiresAt }),
      ...(credential.refreshTokenExpiresAt && { refreshTokenExpiresAt: credential.refreshTokenExpiresAt }),
      grantedScopes: credential.grantedScopes
    }
  }

  private encryptValue(value: string): string {
    return this.encryption.encryptString(value).toString('base64')
  }

  private decryptValue(value: string): string {
    return this.encryption.decryptString(Buffer.from(value, 'base64'))
  }

  private isEncryptionAvailable(): boolean {
    if (!this.encryption.isEncryptionAvailable()) return false
    if (process.platform !== 'linux') return true
    try {
      return LINUX_SECURE_STORAGE_BACKENDS.has(this.encryption.getSelectedStorageBackend())
    } catch {
      return false
    }
  }

  private async replace(file: CredentialFile): Promise<void> {
    const filePath = AbsoluteFilePathSchema.parse(this.filePath)
    await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 })
    await atomicWriteFile(filePath, `${JSON.stringify(credentialFileSchema.parse(file), null, 2)}\n`, { mode: 0o600 })
  }
}

export const externalKnowledgeCredentialStore = new ExternalKnowledgeCredentialStore()
