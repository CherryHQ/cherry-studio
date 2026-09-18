import { describe, expect, it } from 'vitest'

import { knowledgeRequestSchemas } from '../knowledge'

const connection = {
  id: '01960000-0000-7000-8000-000000000001',
  provider: 'feishu',
  appId: 'cli_app',
  appCredentialSource: 'custom-app',
  authorizationStatus: 'connected',
  credentialReference: 'feishu:credential',
  accountOpenId: 'ou_user',
  accountUnionId: null,
  tenantKey: 'tenant',
  displayName: 'User',
  avatarUrl: null,
  applicationName: 'Knowledge app',
  grantedScopes: ['wiki:node:read'],
  authorizedAt: '2026-09-18T00:00:00.000Z',
  lastValidatedAt: '2026-09-18T00:00:00.000Z',
  createdAt: '2026-09-18T00:00:00.000Z',
  updatedAt: '2026-09-18T00:00:00.000Z'
}

describe('Knowledge External Connection IPC schemas', () => {
  it('accepts both PersonalAgent and manual app entries for the same user authorization route', () => {
    const schema = knowledgeRequestSchemas['knowledge.feishu.authorization.begin'].input

    expect(
      schema.safeParse({
        kind: 'personal-agent',
        registrationSessionId: '01960000-0000-7000-8000-000000000002'
      }).success
    ).toBe(true)
    expect(
      schema.safeParse({
        kind: 'custom-app',
        appId: 'cli_manual',
        appSecret: 'private-secret',
        applicationName: 'Manual app'
      }).success
    ).toBe(true)
  })

  it('rejects unknown token fields and invalid identifiers at the IPC boundary', () => {
    const begin = knowledgeRequestSchemas['knowledge.feishu.authorization.begin'].input
    const reconnect = knowledgeRequestSchemas['knowledge.feishu.connection.reconnect'].input

    expect(
      begin.safeParse({ kind: 'custom-app', appId: 'cli_manual', appSecret: 'secret', accessToken: 'x' }).success
    ).toBe(false)
    expect(reconnect.safeParse({ connectionId: 'not-a-uuid' }).success).toBe(false)
  })

  it('accepts replacement application credentials for a connection that cannot reuse its stored credential', () => {
    const reconnect = knowledgeRequestSchemas['knowledge.feishu.connection.reconnect'].input
    const connectionId = '01960000-0000-7000-8000-000000000001'

    expect(
      reconnect.safeParse({
        connectionId,
        credentials: { kind: 'custom-app', appId: 'cli_manual', appSecret: 'private-secret' }
      }).success
    ).toBe(true)
    expect(
      reconnect.safeParse({
        connectionId,
        credentials: {
          kind: 'personal-agent',
          registrationSessionId: '01960000-0000-7000-8000-000000000002'
        }
      }).success
    ).toBe(true)
    expect(
      reconnect.safeParse({
        connectionId,
        credentials: { kind: 'custom-app', appId: 'cli_manual', appSecret: 'private-secret', accessToken: 'x' }
      }).success
    ).toBe(false)
  })

  it('does not permit credentials or tokens in connection command outputs', () => {
    const output = knowledgeRequestSchemas['knowledge.feishu.authorization.complete'].output

    expect(output.safeParse(connection).success).toBe(true)
    expect(output.safeParse({ ...connection, appSecret: 'private-secret' }).success).toBe(false)
    expect(output.safeParse({ ...connection, accessToken: 'private-token' }).success).toBe(false)
    expect(output.safeParse({ ...connection, refreshToken: 'private-refresh' }).success).toBe(false)
  })
})
