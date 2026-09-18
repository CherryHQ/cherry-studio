import { and, desc, eq } from 'drizzle-orm'
import * as z from 'zod'

import { application } from '@application'
import { notifyDataApiDataChange } from '@data/dataApiDataChange'
import {
  type ExternalKnowledgeConnectionRow,
  externalKnowledgeConnectionTable
} from '@data/db/schemas/externalKnowledgeConnection'
import { defaultHandlersFor, withSqliteErrors } from '@data/db/sqliteErrors'
import { loggerService } from '@logger'
import { DataApiErrorFactory, toDataApiError } from '@shared/data/api/errors'
import {
  type ExternalKnowledgeConnection,
  ExternalKnowledgeConnectionSchema,
  ExternalKnowledgeCredentialReferenceSchema,
  ExternalKnowledgeGrantedScopesSchema
} from '@shared/data/types/externalKnowledgeConnection'

import { timestampToISO } from './utils/rowMappers'

const logger = loggerService.withContext('DataApi:ExternalKnowledgeConnectionService')

const NullableNonBlankStringSchema = z.string().trim().min(1).nullable()

const CreateExternalKnowledgeConnectionSchema = z.strictObject({
  appId: z.string().trim().min(1).max(256),
  appCredentialSource: z.enum(['personal-agent', 'custom-app']),
  credentialReference: ExternalKnowledgeCredentialReferenceSchema,
  applicationName: NullableNonBlankStringSchema.optional()
})

const ConnectedExternalKnowledgeIdentitySchema = z.strictObject({
  accountUserId: z.string().trim().min(1),
  accountOpenId: z.string().trim().min(1),
  accountUnionId: NullableNonBlankStringSchema,
  tenantKey: z.string().trim().min(1),
  displayName: NullableNonBlankStringSchema,
  avatarUrl: z.url().nullable(),
  grantedScopes: ExternalKnowledgeGrantedScopesSchema.min(1)
})

const CommitExternalKnowledgeReauthorizationSchema = z
  .strictObject({
    expectedCredentialReference: ExternalKnowledgeCredentialReferenceSchema,
    candidateCredentialReference: ExternalKnowledgeCredentialReferenceSchema,
    appId: z.string().trim().min(1).max(256),
    appCredentialSource: z.enum(['personal-agent', 'custom-app']),
    applicationName: NullableNonBlankStringSchema,
    identity: ConnectedExternalKnowledgeIdentitySchema
  })
  .refine((input) => input.expectedCredentialReference !== input.candidateCredentialReference, {
    path: ['candidateCredentialReference'],
    message: 'Candidate credential reference must differ from the active reference'
  })

export type CreateExternalKnowledgeConnectionInput = z.input<typeof CreateExternalKnowledgeConnectionSchema>
export type ConnectedExternalKnowledgeIdentity = z.input<typeof ConnectedExternalKnowledgeIdentitySchema>
export type CommitExternalKnowledgeReauthorizationInput = z.input<typeof CommitExternalKnowledgeReauthorizationSchema>

function nullableTimestampToISO(value: number | null): string | null {
  return value === null ? null : timestampToISO(value)
}

function rowToEntity(row: ExternalKnowledgeConnectionRow): ExternalKnowledgeConnection {
  return ExternalKnowledgeConnectionSchema.parse({
    ...row,
    authorizedAt: nullableTimestampToISO(row.authorizedAt),
    lastValidatedAt: nullableTimestampToISO(row.lastValidatedAt),
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
  })
}

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown, operation: string): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw toDataApiError(parsed.error, operation)
  return parsed.data
}

export class ExternalKnowledgeConnectionService {
  private get db() {
    return application.get('DbService').getDb()
  }

  list(): ExternalKnowledgeConnection[] {
    return this.db
      .select()
      .from(externalKnowledgeConnectionTable)
      .orderBy(desc(externalKnowledgeConnectionTable.updatedAt), desc(externalKnowledgeConnectionTable.id))
      .all()
      .map(rowToEntity)
  }

  getById(id: string): ExternalKnowledgeConnection | null {
    const row = this.db
      .select()
      .from(externalKnowledgeConnectionTable)
      .where(eq(externalKnowledgeConnectionTable.id, id))
      .limit(1)
      .get()
    return row ? rowToEntity(row) : null
  }

  create(input: CreateExternalKnowledgeConnectionInput): ExternalKnowledgeConnection {
    const parsed = parseOrThrow(CreateExternalKnowledgeConnectionSchema, input, 'create external knowledge connection')
    const [row] = withSqliteErrors(
      () =>
        this.db
          .insert(externalKnowledgeConnectionTable)
          .values({
            provider: 'feishu',
            ...parsed,
            authorizationStatus: 'pending-authorization'
          })
          .returning()
          .all(),
      defaultHandlersFor('ExternalKnowledgeConnection', parsed.credentialReference)
    )
    const connection = rowToEntity(row)
    notifyDataApiDataChange([
      { endpoint: '/external-knowledge-connections', kind: 'membership', entityIds: [connection.id] }
    ])
    logger.info('External Knowledge connection created', { connectionId: connection.id })
    return connection
  }

  markConnected(id: string, identity: ConnectedExternalKnowledgeIdentity): ExternalKnowledgeConnection {
    const parsed = parseOrThrow(
      ConnectedExternalKnowledgeIdentitySchema,
      identity,
      'authorize external knowledge connection'
    )
    const now = Date.now()
    const [row] = this.db
      .update(externalKnowledgeConnectionTable)
      .set({
        ...parsed,
        authorizationStatus: 'connected',
        authorizedAt: now,
        lastValidatedAt: now
      })
      .where(eq(externalKnowledgeConnectionTable.id, id))
      .returning()
      .all()
    if (!row) throw DataApiErrorFactory.notFound('ExternalKnowledgeConnection', id)
    const connection = rowToEntity(row)
    this.notifyProjectionChange(id)
    logger.info('External Knowledge connection authorized', { connectionId: id })
    return connection
  }

  markValidated(id: string, identity: ConnectedExternalKnowledgeIdentity): ExternalKnowledgeConnection {
    const parsed = parseOrThrow(
      ConnectedExternalKnowledgeIdentitySchema,
      identity,
      'validate external knowledge connection'
    )
    const [row] = this.db
      .update(externalKnowledgeConnectionTable)
      .set({ ...parsed, lastValidatedAt: Date.now() })
      .where(eq(externalKnowledgeConnectionTable.id, id))
      .returning()
      .all()
    if (!row) throw DataApiErrorFactory.notFound('ExternalKnowledgeConnection', id)
    const connection = rowToEntity(row)
    this.notifyProjectionChange(id)
    return connection
  }

  markReauthorizationRequired(id: string): ExternalKnowledgeConnection {
    const [row] = this.db
      .update(externalKnowledgeConnectionTable)
      .set({ authorizationStatus: 'reauthorization-required' })
      .where(eq(externalKnowledgeConnectionTable.id, id))
      .returning()
      .all()
    if (!row) throw DataApiErrorFactory.notFound('ExternalKnowledgeConnection', id)
    const connection = rowToEntity(row)
    this.notifyProjectionChange(id)
    logger.info('External Knowledge connection requires reauthorization', { connectionId: id })
    return connection
  }

  commitReauthorization(id: string, input: CommitExternalKnowledgeReauthorizationInput): ExternalKnowledgeConnection {
    const parsed = parseOrThrow(
      CommitExternalKnowledgeReauthorizationSchema,
      input,
      'commit external knowledge reauthorization'
    )
    const now = Date.now()
    const [row] = this.db
      .update(externalKnowledgeConnectionTable)
      .set({
        credentialReference: parsed.candidateCredentialReference,
        appId: parsed.appId,
        appCredentialSource: parsed.appCredentialSource,
        applicationName: parsed.applicationName,
        ...parsed.identity,
        authorizationStatus: 'connected',
        authorizedAt: now,
        lastValidatedAt: now
      })
      .where(
        and(
          eq(externalKnowledgeConnectionTable.id, id),
          eq(externalKnowledgeConnectionTable.credentialReference, parsed.expectedCredentialReference),
          eq(externalKnowledgeConnectionTable.authorizationStatus, 'reauthorization-required')
        )
      )
      .returning()
      .all()
    if (!row) {
      if (!this.getById(id)) throw DataApiErrorFactory.notFound('ExternalKnowledgeConnection', id)
      throw DataApiErrorFactory.concurrentModification('ExternalKnowledgeConnection', id)
    }
    const connection = rowToEntity(row)
    this.notifyProjectionChange(id)
    logger.info('External Knowledge reauthorization committed', { connectionId: id })
    return connection
  }

  remove(id: string): boolean {
    const removed =
      this.db
        .delete(externalKnowledgeConnectionTable)
        .where(eq(externalKnowledgeConnectionTable.id, id))
        .returning()
        .all().length > 0
    if (removed) {
      notifyDataApiDataChange([
        { endpoint: '/external-knowledge-connections', kind: 'membership', entityIds: [id] },
        { endpoint: '/external-knowledge-connections/:id', routeParams: { id }, entityIds: [id] }
      ])
      logger.info('External Knowledge connection removed', { connectionId: id })
    }
    return removed
  }

  private notifyProjectionChange(id: string): void {
    notifyDataApiDataChange([
      { endpoint: '/external-knowledge-connections', kind: 'projection', entityIds: [id] },
      { endpoint: '/external-knowledge-connections/:id', routeParams: { id }, entityIds: [id] }
    ])
  }
}

export const externalKnowledgeConnectionService = new ExternalKnowledgeConnectionService()
