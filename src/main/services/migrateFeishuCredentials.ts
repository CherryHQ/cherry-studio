import { and, eq } from 'drizzle-orm'
import * as z from 'zod'

import { application } from '@application'
import { agentChannelTable } from '@data/db/schemas/agentChannel'
import { externalKnowledgeConnectionTable } from '@data/db/schemas/externalKnowledgeConnection'
import { CredentialStoreError, type CredentialStoreService } from '@main/services/credential'
import type { LegacyFeishuCredentialStore } from '@main/services/LegacyFeishuCredentialStore'
import { CredentialIdSchema, FeishuApplicationInputSchema } from '@shared/types/credential'

const legacyChannelSchema = z.object({
  app_id: z.string(),
  app_secret: z.string(),
  encrypt_key: z.string().optional(),
  verification_token: z.string().optional(),
  domain: z.enum(['feishu', 'lark']),
  allowed_chat_ids: z.array(z.string()).optional()
})
type ApplicationInput = z.infer<typeof FeishuApplicationInputSchema>
type GrantTokens = Parameters<CredentialStoreService['rotateTokens']>[2]
type Candidate = {
  kind: 'channel' | 'connection'
  id: string
  application: ApplicationInput
  config?: Record<string, unknown>
  reference?: string
  tokens?: GrantTokens | null
}

export type FeishuCredentialMigrationResult = {
  migratedChannels: string[]
  migratedConnections: string[]
  blockedChannels: string[]
  blockedConnections: string[]
  cleanupPending: string[]
  unreferencedLegacyCredentials: string[]
}

/** Converts old bindings before either consumer starts. File writes precede conditional database commits. */
export async function migrateFeishuCredentials(
  store: CredentialStoreService,
  legacy: Pick<LegacyFeishuCredentialStore, 'read' | 'remove' | 'listReferences'>
): Promise<FeishuCredentialMigrationResult> {
  const db = application.get('DbService').getDb()
  const result: FeishuCredentialMigrationResult = {
    migratedChannels: [],
    migratedConnections: [],
    blockedChannels: [],
    blockedConnections: [],
    cleanupPending: [],
    unreferencedLegacyCredentials: []
  }
  const candidates: Candidate[] = []
  const block = (candidate: Pick<Candidate, 'kind' | 'id'>) => {
    const ids = candidate.kind === 'channel' ? result.blockedChannels : result.blockedConnections
    if (!ids.includes(candidate.id)) ids.push(candidate.id)
  }
  for (const row of db.select().from(agentChannelTable).where(eq(agentChannelTable.type, 'feishu')).all()) {
    if ('applicationCredentialId' in row.config) continue
    const parsed = legacyChannelSchema.safeParse(row.config)
    if (!parsed.success) {
      block({ kind: 'channel', id: row.id })
      continue
    }
    const config = parsed.data
    if (
      ![config.app_id, config.app_secret, config.encrypt_key, config.verification_token].some((value) => value?.trim())
    ) {
      db.update(agentChannelTable)
        .set({
          config: {
            applicationCredentialId: null,
            registrationDomain: config.domain,
            allowed_chat_ids: config.allowed_chat_ids ?? []
          }
        })
        .where(and(eq(agentChannelTable.id, row.id), eq(agentChannelTable.config, row.config)))
        .run()
      continue
    }
    const input = FeishuApplicationInputSchema.safeParse({
      label: row.name,
      domain: config.domain,
      appId: config.app_id,
      appSecret: config.app_secret,
      ...(config.encrypt_key && { encryptKey: config.encrypt_key }),
      ...(config.verification_token && { verificationToken: config.verification_token })
    })
    if (!input.success) {
      block({ kind: 'channel', id: row.id })
      continue
    }
    candidates.push({ kind: 'channel', id: row.id, application: input.data, config: row.config })
  }
  for (const row of db.select().from(externalKnowledgeConnectionTable).all()) {
    if (CredentialIdSchema.safeParse(row.credentialReference).success) {
      const oldReference = `feishu:${row.credentialReference}`
      try {
        const old = await legacy.read(oldReference)
        if (old.status === 'missing') continue
        const grant = await store.read(row.credentialReference)
        if (old.status !== 'ok' || grant.status !== 'ok' || grant.record.kind !== 'user-authorization') {
          result.cleanupPending.push(row.id)
          continue
        }
        const app = await store.read(grant.record.payload.applicationCredentialId)
        if (
          app.status !== 'ok' ||
          app.record.kind !== 'application' ||
          app.record.payload.appId !== old.credential.appId ||
          old.credential.appId !== row.appId
        ) {
          result.cleanupPending.push(row.id)
          continue
        }
        await legacy.remove(oldReference)
      } catch {
        result.cleanupPending.push(row.id)
      }
      continue
    }
    try {
      if (
        !row.credentialReference.startsWith('feishu:') ||
        !CredentialIdSchema.safeParse(row.credentialReference.slice(7)).success
      ) {
        throw new CredentialStoreError('invalid')
      }
      const read = await legacy.read(row.credentialReference)
      if (read.status !== 'ok') throw new CredentialStoreError('unreadable')
      const credential = read.credential
      if (credential.appId !== row.appId) throw new CredentialStoreError('conflict')
      const tokenValues = [
        credential.accessToken,
        credential.refreshToken,
        credential.accessTokenExpiresAt,
        credential.refreshTokenExpiresAt
      ]
      const pending = tokenValues.every((value) => value === undefined)
      if (!pending && tokenValues.some((value) => value === undefined)) throw new CredentialStoreError('invalid')
      if (pending && row.authorizedAt !== null) throw new CredentialStoreError('invalid')
      candidates.push({
        kind: 'connection',
        id: row.id,
        reference: row.credentialReference,
        application: FeishuApplicationInputSchema.parse({
          label: row.applicationName || row.appId,
          domain: 'feishu',
          appId: credential.appId,
          appSecret: credential.appSecret
        }),
        tokens: pending
          ? null
          : {
              accessToken: credential.accessToken!,
              refreshToken: credential.refreshToken!,
              accessTokenExpiresAt: credential.accessTokenExpiresAt!,
              refreshTokenExpiresAt: credential.refreshTokenExpiresAt!,
              grantedScopes: credential.grantedScopes
            }
      })
    } catch {
      block({ kind: 'connection', id: row.id })
    }
  }

  const groups = Map.groupBy(candidates, ({ application: value }) => JSON.stringify([value.domain, value.appId]))
  for (const group of groups.values()) {
    try {
      const merged = { ...group[0].application }
      const summaries = await store.listSummaries({ connector: 'feishu', kind: 'application' })
      if (summaries.some((entry) => entry.status !== 'available')) throw new CredentialStoreError('corrupt')
      const existing = summaries.find(
        (entry) =>
          entry.status === 'available' &&
          entry.kind === 'application' &&
          entry.domain === merged.domain &&
          entry.appId === merged.appId
      )
      const materials = group.map((candidate) => candidate.application)
      if (existing) {
        const read = await store.read(existing.id)
        if (read.status !== 'ok' || read.record.kind !== 'application') throw new CredentialStoreError('unreadable')
        materials.push({ label: read.record.label, ...read.record.payload })
      }
      for (const material of materials) {
        for (const key of ['appSecret', 'encryptKey', 'verificationToken'] as const) {
          const value = material[key]
          if (!value) continue
          if (merged[key] && merged[key] !== value) throw new CredentialStoreError('conflict')
          merged[key] = value
        }
      }
      const { label, ...payload } = merged
      const app = existing
        ? await store.replaceApplication({
            id: existing.id,
            ...(payload.encryptKey && { encryptKey: payload.encryptKey }),
            ...(payload.verificationToken && { verificationToken: payload.verificationToken }),
            appSecret: payload.appSecret
          })
        : await store.create({ connector: 'feishu', kind: 'application', label, payload })
      for (const candidate of group) {
        try {
          const grantId = candidate.reference?.slice(7)
          if (grantId) {
            const prior = await store.read(grantId)
            if (prior.status === 'missing') {
              await store.create(
                {
                  connector: 'feishu',
                  kind: 'user-authorization',
                  label: candidate.application.label,
                  payload: { applicationCredentialId: app.id, tokens: candidate.tokens ?? null }
                },
                grantId
              )
            } else if (
              prior.status !== 'ok' ||
              prior.record.kind !== 'user-authorization' ||
              prior.record.payload.applicationCredentialId !== app.id
            ) {
              throw new CredentialStoreError('conflict')
            }
          }
          const changed = await store.withReferences(grantId ? [app.id, grantId] : [app.id], (records, tx) => {
            const currentApp = records[0]
            if (currentApp.kind !== 'application' || currentApp.payload.appSecret !== payload.appSecret)
              throw new CredentialStoreError('conflict')
            if (candidate.kind === 'channel') {
              const config = candidate.config!
              const parsed = legacyChannelSchema.parse(config)
              return tx
                .update(agentChannelTable)
                .set({ config: { applicationCredentialId: app.id, allowed_chat_ids: parsed.allowed_chat_ids ?? [] } })
                .where(and(eq(agentChannelTable.id, candidate.id), eq(agentChannelTable.config, config)))
                .run().changes
            }
            return tx
              .update(externalKnowledgeConnectionTable)
              .set({ credentialReference: grantId! })
              .where(
                and(
                  eq(externalKnowledgeConnectionTable.id, candidate.id),
                  eq(externalKnowledgeConnectionTable.credentialReference, candidate.reference!)
                )
              )
              .run().changes
          })
          if (changed !== 1) throw new CredentialStoreError('conflict')
          if (candidate.kind === 'channel') result.migratedChannels.push(candidate.id)
          else {
            result.migratedConnections.push(candidate.id)
            try {
              await legacy.remove(candidate.reference!)
            } catch {
              result.cleanupPending.push(candidate.id)
            }
          }
        } catch {
          block(candidate)
        }
      }
    } catch {
      for (const candidate of group) block(candidate)
    }
  }
  const remaining = await legacy.listReferences()
  if (remaining.status === 'ok') {
    const referenced = new Set(
      db
        .select({ reference: externalKnowledgeConnectionTable.credentialReference })
        .from(externalKnowledgeConnectionTable)
        .all()
        .map(({ reference }) => (CredentialIdSchema.safeParse(reference).success ? `feishu:${reference}` : reference))
    )
    result.unreferencedLegacyCredentials = remaining.credentialReferences.filter(
      (reference) => !referenced.has(reference)
    )
  }
  return result
}
