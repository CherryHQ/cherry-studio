import { sql } from 'drizzle-orm'
import { check, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import type {
  ExternalKnowledgeAppCredentialSource,
  ExternalKnowledgeAuthorizationStatus,
  ExternalKnowledgeConnectionProvider
} from '@shared/data/types/externalKnowledgeConnection'

import { createUpdateTimestamps, uuidPrimaryKeyOrdered } from './_columnHelpers'

export const externalKnowledgeConnectionTable = sqliteTable(
  'external_knowledge_connection',
  {
    id: uuidPrimaryKeyOrdered(),
    provider: text().$type<ExternalKnowledgeConnectionProvider>().notNull(),
    appId: text().notNull(),
    appCredentialSource: text().$type<ExternalKnowledgeAppCredentialSource>().notNull(),
    authorizationStatus: text().$type<ExternalKnowledgeAuthorizationStatus>().notNull(),
    credentialReference: text().notNull(),
    accountUserId: text(),
    accountOpenId: text(),
    accountUnionId: text(),
    tenantKey: text(),
    displayName: text(),
    avatarUrl: text(),
    applicationName: text(),
    grantedScopes: text({ mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    authorizedAt: integer(),
    lastValidatedAt: integer(),
    ...createUpdateTimestamps
  },
  (t) => [
    uniqueIndex('external_knowledge_connection_credential_reference_unique_idx').on(t.credentialReference),
    check('external_knowledge_connection_provider_check', sql`${t.provider} = 'feishu'`),
    check(
      'external_knowledge_connection_app_credential_source_check',
      sql`${t.appCredentialSource} IN ('personal-agent', 'custom-app')`
    ),
    check(
      'external_knowledge_connection_authorization_status_check',
      sql`${t.authorizationStatus} IN ('pending-authorization', 'connected', 'reauthorization-required')`
    ),
    check('external_knowledge_connection_app_id_nonempty_check', sql`length(trim(${t.appId})) > 0`),
    check(
      'external_knowledge_connection_credential_reference_nonempty_check',
      sql`length(trim(${t.credentialReference})) > 0`
    ),
    check(
      'external_knowledge_connection_identity_nonempty_check',
      sql`(${t.accountUserId} IS NULL OR length(trim(${t.accountUserId})) > 0)
          AND (${t.accountOpenId} IS NULL OR length(trim(${t.accountOpenId})) > 0)
          AND (${t.accountUnionId} IS NULL OR length(trim(${t.accountUnionId})) > 0)
          AND (${t.tenantKey} IS NULL OR length(trim(${t.tenantKey})) > 0)`
    ),
    check(
      'external_knowledge_connection_display_nonempty_check',
      sql`(${t.displayName} IS NULL OR length(trim(${t.displayName})) > 0)
          AND (${t.avatarUrl} IS NULL OR length(trim(${t.avatarUrl})) > 0)
          AND (${t.applicationName} IS NULL OR length(trim(${t.applicationName})) > 0)`
    ),
    check(
      'external_knowledge_connection_granted_scopes_json_check',
      sql`json_valid(${t.grantedScopes}) AND json_type(${t.grantedScopes}) = 'array'`
    ),
    check(
      'external_knowledge_connection_connected_identity_check',
      sql`${t.authorizationStatus} != 'connected' OR (
        ${t.accountUserId} IS NOT NULL
        AND ${t.accountOpenId} IS NOT NULL
        AND ${t.tenantKey} IS NOT NULL
        AND ${t.authorizedAt} IS NOT NULL
        AND json_array_length(${t.grantedScopes}) > 0
      )`
    ),
    check(
      'external_knowledge_connection_pending_identity_check',
      sql`${t.authorizationStatus} != 'pending-authorization' OR (
        ${t.accountUserId} IS NULL
        AND ${t.accountOpenId} IS NULL
        AND ${t.accountUnionId} IS NULL
        AND ${t.tenantKey} IS NULL
        AND ${t.displayName} IS NULL
        AND ${t.avatarUrl} IS NULL
        AND ${t.authorizedAt} IS NULL
        AND ${t.lastValidatedAt} IS NULL
        AND json_array_length(${t.grantedScopes}) = 0
      )`
    )
  ]
)

export type ExternalKnowledgeConnectionRow = typeof externalKnowledgeConnectionTable.$inferSelect
export type InsertExternalKnowledgeConnectionRow = typeof externalKnowledgeConnectionTable.$inferInsert
