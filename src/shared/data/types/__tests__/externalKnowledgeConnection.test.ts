import { describe, expect, it } from 'vitest'

const validConnection = {
  id: '01994c00-ef10-7000-8000-000000000001',
  provider: 'feishu',
  appId: 'cli_example',
  appCredentialSource: 'personal-agent',
  authorizationStatus: 'connected',
  credentialReference: 'cred_01994c00ef10',
  accountUserId: 'user_example',
  accountOpenId: 'ou_example',
  accountUnionId: 'on_example',
  tenantKey: 'tenant_example',
  displayName: 'Cherry User',
  avatarUrl: 'https://example.com/avatar.png',
  applicationName: 'Cherry Knowledge',
  grantedScopes: ['wiki:node:read', 'offline_access'],
  authorizedAt: '2026-09-18T10:00:00.000Z',
  lastValidatedAt: '2026-09-18T10:05:00.000Z',
  createdAt: '2026-09-18T09:55:00.000Z',
  updatedAt: '2026-09-18T10:05:00.000Z'
} as const

describe('ExternalKnowledgeConnectionSchema', () => {
  it('accepts a renderer-safe connected Feishu connection', async () => {
    const { ExternalKnowledgeConnectionSchema } = await import('../externalKnowledgeConnection')

    expect(ExternalKnowledgeConnectionSchema.parse(validConnection)).toEqual(validConnection)
  })

  it.each(['appSecret', 'accessToken', 'refreshToken'])('rejects the secret field %s', async (secretField) => {
    const { ExternalKnowledgeConnectionSchema } = await import('../externalKnowledgeConnection')

    expect(
      ExternalKnowledgeConnectionSchema.safeParse({ ...validConnection, [secretField]: 'must-not-cross-the-boundary' })
        .success
    ).toBe(false)
  })

  it('requires connected rows to carry the user and tenant identity established by authorization', async () => {
    const { ExternalKnowledgeConnectionSchema } = await import('../externalKnowledgeConnection')

    expect(
      ExternalKnowledgeConnectionSchema.safeParse({
        ...validConnection,
        accountUserId: null,
        accountOpenId: null,
        tenantKey: null,
        authorizedAt: null
      }).success
    ).toBe(false)
  })

  it('requires accountUserId on a connected connection', async () => {
    const { ExternalKnowledgeConnectionSchema } = await import('../externalKnowledgeConnection')

    expect(ExternalKnowledgeConnectionSchema.safeParse({ ...validConnection, accountUserId: null }).success).toBe(false)
  })

  it('allows a pending authorization to exist before identity and scopes are available', async () => {
    const { ExternalKnowledgeConnectionSchema } = await import('../externalKnowledgeConnection')

    expect(
      ExternalKnowledgeConnectionSchema.parse({
        ...validConnection,
        authorizationStatus: 'pending-authorization',
        accountUserId: null,
        accountOpenId: null,
        accountUnionId: null,
        tenantKey: null,
        displayName: null,
        avatarUrl: null,
        grantedScopes: [],
        authorizedAt: null,
        lastValidatedAt: null
      })
    ).toMatchObject({ authorizationStatus: 'pending-authorization', grantedScopes: [] })
  })

  it('rejects accountUserId on a pending connection', async () => {
    const { ExternalKnowledgeConnectionSchema } = await import('../externalKnowledgeConnection')

    expect(
      ExternalKnowledgeConnectionSchema.safeParse({
        ...validConnection,
        authorizationStatus: 'pending-authorization',
        accountUserId: 'user_example',
        accountOpenId: null,
        accountUnionId: null,
        tenantKey: null,
        displayName: null,
        avatarUrl: null,
        grantedScopes: [],
        authorizedAt: null,
        lastValidatedAt: null
      }).success
    ).toBe(false)
  })

  it('rejects authorized identity data on a pending connection', async () => {
    const { ExternalKnowledgeConnectionSchema } = await import('../externalKnowledgeConnection')

    expect(
      ExternalKnowledgeConnectionSchema.safeParse({
        ...validConnection,
        authorizationStatus: 'pending-authorization'
      }).success
    ).toBe(false)
  })
})
