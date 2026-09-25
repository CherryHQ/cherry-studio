import * as z from 'zod'

export const EXTERNAL_KNOWLEDGE_CONNECTION_PROVIDERS = ['feishu'] as const
export const ExternalKnowledgeConnectionProviderSchema = z.enum(EXTERNAL_KNOWLEDGE_CONNECTION_PROVIDERS)
export type ExternalKnowledgeConnectionProvider = z.infer<typeof ExternalKnowledgeConnectionProviderSchema>

export const EXTERNAL_KNOWLEDGE_APP_CREDENTIAL_SOURCES = ['personal-agent', 'custom-app'] as const
export const ExternalKnowledgeAppCredentialSourceSchema = z.enum(EXTERNAL_KNOWLEDGE_APP_CREDENTIAL_SOURCES)
export type ExternalKnowledgeAppCredentialSource = z.infer<typeof ExternalKnowledgeAppCredentialSourceSchema>

export const EXTERNAL_KNOWLEDGE_AUTHORIZATION_STATUSES = [
  'pending-authorization',
  'connected',
  'reauthorization-required'
] as const
export const ExternalKnowledgeAuthorizationStatusSchema = z.enum(EXTERNAL_KNOWLEDGE_AUTHORIZATION_STATUSES)
export type ExternalKnowledgeAuthorizationStatus = z.infer<typeof ExternalKnowledgeAuthorizationStatusSchema>

const NonBlankStringSchema = z.string().trim().min(1)
const NullableNonBlankStringSchema = NonBlankStringSchema.nullable()

export const ExternalKnowledgeCredentialReferenceSchema = NonBlankStringSchema.max(256)
export const ExternalKnowledgeGrantedScopesSchema = z
  .array(NonBlankStringSchema.max(256))
  .max(256)
  .refine((scopes) => new Set(scopes).size === scopes.length, 'Granted scopes must be unique')

export const ExternalKnowledgeConnectionSchema = z
  .strictObject({
    id: z.uuidv7(),
    provider: z.literal('feishu'),
    appId: NonBlankStringSchema.max(256),
    appCredentialSource: ExternalKnowledgeAppCredentialSourceSchema,
    authorizationStatus: ExternalKnowledgeAuthorizationStatusSchema,
    credentialReference: ExternalKnowledgeCredentialReferenceSchema,
    accountUserId: NullableNonBlankStringSchema,
    accountOpenId: NullableNonBlankStringSchema,
    accountUnionId: NullableNonBlankStringSchema,
    tenantKey: NullableNonBlankStringSchema,
    displayName: NullableNonBlankStringSchema,
    avatarUrl: z.url().nullable(),
    applicationName: NullableNonBlankStringSchema,
    grantedScopes: ExternalKnowledgeGrantedScopesSchema,
    authorizedAt: z.iso.datetime().nullable(),
    lastValidatedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime()
  })
  .superRefine((value, ctx) => {
    if (value.authorizationStatus === 'pending-authorization') {
      for (const field of [
        'accountUserId',
        'accountOpenId',
        'accountUnionId',
        'tenantKey',
        'displayName',
        'avatarUrl',
        'authorizedAt',
        'lastValidatedAt'
      ] as const) {
        if (value[field] !== null) {
          ctx.addIssue({ code: 'custom', path: [field], message: `Pending connection cannot have ${field}` })
        }
      }

      if (value.grantedScopes.length > 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['grantedScopes'],
          message: 'Pending connection cannot have granted scopes'
        })
      }
      return
    }

    if (value.authorizationStatus !== 'connected') return

    for (const field of ['accountUserId', 'accountOpenId', 'tenantKey', 'authorizedAt'] as const) {
      if (value[field] === null) {
        ctx.addIssue({ code: 'custom', path: [field], message: `Connected connection requires ${field}` })
      }
    }

    if (value.grantedScopes.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['grantedScopes'], message: 'Connected connection requires granted scopes' })
    }
  })

export type ExternalKnowledgeConnection = z.infer<typeof ExternalKnowledgeConnectionSchema>
