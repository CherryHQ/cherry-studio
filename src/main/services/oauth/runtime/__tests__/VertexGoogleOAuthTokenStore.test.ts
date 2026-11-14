// Load the sibling so it self-registers in the data-service registry (prod loads it via its DataApi handler).
import '@data/services/ProviderRegistryService'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { userProviderTable } from '@data/db/schemas/userProvider'
import type { AuthConfig } from '@shared/data/types/provider'

import { OAuthServiceError } from '../../errors'
import { VertexGoogleOAuthTokenStore } from '../OAuthTokenStore'

const PROVIDER_ID = 'my-vertex'
const client = { type: 'authorized_user', clientId: 'cid', clientSecret: 'cs' }
const session = { refreshToken: 'refresh-1', accessToken: 'access-1', expiresAt: 123, account: 'person@example.com' }

describe('VertexGoogleOAuthTokenStore', () => {
  const dbh = setupTestDatabase()
  const store = new VertexGoogleOAuthTokenStore()

  async function seed(credentials: Record<string, unknown>) {
    await dbh.db.insert(userProviderTable).values({
      providerId: PROVIDER_ID,
      name: 'Vertex',
      orderKey: 'a0',
      isEnabled: true,
      authConfig: { type: 'iam-gcp', project: 'proj', location: 'us-central1', credentials }
    })
  }

  async function readRow() {
    const [row] = await dbh.db.select().from(userProviderTable).where(eq(userProviderTable.providerId, PROVIDER_ID))
    return row
  }

  it('reads the session out of the iam-gcp credentials', async () => {
    await seed({ ...client, ...session })

    expect(await store.get(PROVIDER_ID)).toEqual({
      refreshToken: 'refresh-1',
      accessToken: 'access-1',
      expiresAt: 123,
      accountId: 'person@example.com'
    })
  })

  it('has no session when only the OAuth client is saved', async () => {
    await seed(client)

    expect(await store.get(PROVIDER_ID)).toBeNull()
  })

  it('stores a sign-in without losing project, location or the OAuth client', async () => {
    await seed(client)

    await store.set(PROVIDER_ID, { accessToken: 'access-1', refreshToken: 'refresh-1', accountId: 'a@x' }, 'cid')

    expect((await readRow()).authConfig).toEqual<AuthConfig>({
      type: 'iam-gcp',
      project: 'proj',
      location: 'us-central1',
      credentials: { ...client, accessToken: 'access-1', refreshToken: 'refresh-1', account: 'a@x' }
    })
  })

  it('refuses tokens minted by a client other than the saved one', async () => {
    await seed({ ...client, clientId: 'other-cid' })

    await expect(store.set(PROVIDER_ID, { accessToken: 'access-1', refreshToken: 'refresh-1' }, 'cid')).rejects.toThrow(
      OAuthServiceError
    )

    expect((await readRow()).authConfig).toMatchObject({ credentials: { ...client, clientId: 'other-cid' } })
    expect((await readRow()).authConfig).not.toHaveProperty('credentials.refreshToken')
  })

  it('stores a refresh made with the saved client', async () => {
    await seed({ ...client, ...session })

    await store.set(PROVIDER_ID, { accessToken: 'access-2', refreshToken: 'refresh-1', expiresAt: 456 }, 'cid', {
      expectedRefreshToken: 'refresh-1'
    })

    expect((await readRow()).authConfig).toMatchObject({
      credentials: { ...client, accessToken: 'access-2', refreshToken: 'refresh-1', expiresAt: 456 }
    })
  })

  it('skips a refresh write when the session changed meanwhile', async () => {
    await seed({ ...client, ...session, refreshToken: 'refresh-new' })

    await store.set(PROVIDER_ID, { accessToken: 'stale', refreshToken: 'refresh-1' }, 'cid', {
      expectedRefreshToken: 'refresh-1'
    })

    expect((await readRow()).authConfig).toMatchObject({ credentials: { refreshToken: 'refresh-new' } })
  })

  it('clears only the session and keeps the provider configured and enabled', async () => {
    await seed({ ...client, ...session })

    await store.clear(PROVIDER_ID, { disableProvider: true })

    const row = await readRow()
    expect(row.authConfig).toEqual<AuthConfig>({
      type: 'iam-gcp',
      project: 'proj',
      location: 'us-central1',
      credentials: client
    })
    expect(row.isEnabled).toBe(true)
  })

  it('does not clear a session whose refresh token no longer matches', async () => {
    await seed({ ...client, ...session, refreshToken: 'refresh-new' })

    await store.clear(PROVIDER_ID, { expectedRefreshToken: 'refresh-1' })

    expect((await readRow()).authConfig).toMatchObject({ credentials: { refreshToken: 'refresh-new' } })
  })
})
