import { eq } from 'drizzle-orm'

import { application } from '@application'
import { externalKnowledgeConnectionTable } from '@data/db/schemas/externalKnowledgeConnection'
import { CredentialStoreError, type CredentialStoreService } from '@main/services/credential'
import { CredentialIdSchema } from '@shared/types/credential'

type ApplicationSnapshot = Parameters<CredentialStoreService['rotateTokens']>[1]
export type ExternalKnowledgeTokenSet = Parameters<CredentialStoreService['rotateTokens']>[2]
export type ExternalKnowledgeCredential = {
  appId: string
  appSecret: string
  accessToken?: string
  refreshToken?: string
  accessTokenExpiresAt?: number
  refreshTokenExpiresAt?: number
  grantedScopes: string[]
  applicationSnapshot?: Omit<ApplicationSnapshot, 'refreshToken'>
}
export type ExternalKnowledgeCredentialReadResult =
  | { status: 'ok'; credential: ExternalKnowledgeCredential }
  | { status: 'missing' | 'corrupt' | 'undecryptable' }
export type TokenRotationResult = 'updated' | 'missing' | 'stale' | 'corrupt' | 'undecryptable'

export class ExternalKnowledgeCredentialStore {
  constructor(private readonly configuredStore?: CredentialStoreService) {}

  private get store() {
    return this.configuredStore ?? application.get('CredentialStoreService')
  }

  async readApplication(id: string) {
    const read = await this.store.read(id)
    if (read.status !== 'ok' || read.record.kind !== 'application' || read.record.payload.domain !== 'feishu')
      throw new CredentialStoreError('missing')
    return {
      appId: read.record.payload.appId,
      appSecret: read.record.payload.appSecret,
      applicationName: read.record.label,
      applicationSnapshot: { applicationCredentialId: id, application: read.record.payload }
    }
  }

  async read(reference: string): Promise<ExternalKnowledgeCredentialReadResult> {
    if (!CredentialIdSchema.safeParse(reference).success) return { status: 'missing' }
    const grant = await this.store.read(reference)
    if (grant.status !== 'ok') return { status: grant.status === 'unreadable' ? 'undecryptable' : grant.status }
    if (grant.record.kind !== 'user-authorization') return { status: 'corrupt' }
    const { applicationCredentialId, tokens } = grant.record.payload
    const app = await this.store.read(applicationCredentialId)
    if (app.status !== 'ok') return { status: app.status === 'unreadable' ? 'undecryptable' : app.status }
    if (app.record.kind !== 'application' || app.record.payload.domain !== 'feishu') return { status: 'corrupt' }
    return {
      status: 'ok',
      credential: {
        appId: app.record.payload.appId,
        appSecret: app.record.payload.appSecret,
        grantedScopes: [],
        ...tokens,
        applicationSnapshot: { applicationCredentialId, application: app.record.payload }
      }
    }
  }

  async put(reference: string, credential: ExternalKnowledgeCredential): Promise<void> {
    const applications = await this.store.listSummaries({ connector: 'feishu', kind: 'application' })
    const existing =
      credential.applicationSnapshot ??
      applications.find(
        (entry) =>
          entry.status === 'available' &&
          entry.kind === 'application' &&
          entry.domain === 'feishu' &&
          entry.appId === credential.appId
      )
    let applicationCredentialId: string
    if (existing) {
      const id = 'applicationCredentialId' in existing ? existing.applicationCredentialId : existing.id
      const read = await this.store.read(id)
      if (
        read.status !== 'ok' ||
        read.record.kind !== 'application' ||
        read.record.payload.appSecret !== credential.appSecret ||
        read.record.payload.appId !== credential.appId ||
        read.record.payload.domain !== 'feishu'
      )
        throw new CredentialStoreError('conflict')
      applicationCredentialId = id
    } else {
      const app = await this.store.create({
        connector: 'feishu',
        kind: 'application',
        label: credential.appId,
        payload: { domain: 'feishu', appId: credential.appId, appSecret: credential.appSecret }
      })
      applicationCredentialId = app.id
    }
    const { accessToken, refreshToken, accessTokenExpiresAt, refreshTokenExpiresAt, grantedScopes } = credential
    if (!accessToken || !refreshToken || !accessTokenExpiresAt || !refreshTokenExpiresAt)
      throw new CredentialStoreError('invalid')
    await this.store.create(
      {
        connector: 'feishu',
        kind: 'user-authorization',
        label: credential.appId,
        payload: {
          applicationCredentialId,
          tokens: { accessToken, refreshToken, accessTokenExpiresAt, refreshTokenExpiresAt, grantedScopes }
        }
      },
      reference
    )
  }

  async rotateTokens(
    reference: string,
    expected: ExternalKnowledgeCredential,
    tokens: ExternalKnowledgeTokenSet
  ): Promise<TokenRotationResult> {
    if (!expected.applicationSnapshot || !expected.refreshToken) return 'stale'
    return this.store.rotateTokens(
      reference,
      { ...expected.applicationSnapshot, refreshToken: expected.refreshToken },
      tokens
    )
  }

  async commit<T>(
    reference: string,
    expected: { appId: string; appSecret: string },
    commit: () => T extends PromiseLike<unknown> ? never : T
  ): Promise<T> {
    const grant = await this.store.read(reference)
    if (grant.status !== 'ok' || grant.record.kind !== 'user-authorization') throw new CredentialStoreError('missing')
    return this.store.withReferences([reference, grant.record.payload.applicationCredentialId], (records) => {
      const [current, app] = records
      if (
        current.kind !== 'user-authorization' ||
        app.kind !== 'application' ||
        current.payload.applicationCredentialId !== app.id ||
        app.payload.appId !== expected.appId ||
        app.payload.appSecret !== expected.appSecret
      )
        throw new CredentialStoreError('conflict')
      return commit()
    })
  }

  async remove(reference: string, release?: () => void): Promise<void> {
    if (release) await this.store.withReferences([], () => release())
    if (!CredentialIdSchema.safeParse(reference).success) return
    await this.store.remove(reference, (id) =>
      Boolean(
        application
          .get('DbService')
          .getDb()
          .select({ id: externalKnowledgeConnectionTable.id })
          .from(externalKnowledgeConnectionTable)
          .where(eq(externalKnowledgeConnectionTable.credentialReference, id))
          .get()
      )
    )
  }
}

export const externalKnowledgeCredentialStore = new ExternalKnowledgeCredentialStore()
