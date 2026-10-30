import { randomUUID } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { externalKnowledgeConnectionService as connections } from '@data/services/ExternalKnowledgeConnectionService'
import { applicationInput, setupCredentialStore, tokens } from '@main/services/credential/__tests__/credentialTestSetup'

import { ExternalKnowledgeCredentialStore } from '../ExternalKnowledgeCredentialStore'

describe('shared knowledge credentials', () => {
  const fixture = setupCredentialStore()

  it('reuses a channel application without losing bot verification secrets and isolates user tokens', async () => {
    const app = await fixture.store.create(applicationInput)
    const knowledge = new ExternalKnowledgeCredentialStore(fixture.store)
    const first = randomUUID()
    const second = randomUUID()
    await knowledge.put(first, { ...applicationInput.payload, ...tokens })
    await knowledge.put(second, { ...applicationInput.payload, ...tokens, refreshToken: 'second-refresh' })
    expect(await fixture.store.read(app.id)).toMatchObject({
      status: 'ok',
      record: { payload: applicationInput.payload }
    })
    expect(await knowledge.read(first)).toMatchObject({
      status: 'ok',
      credential: { ...tokens, applicationSnapshot: { applicationCredentialId: app.id } }
    })
    await knowledge.remove(second)
    expect(await knowledge.read(first)).toMatchObject({ status: 'ok', credential: tokens })
    expect(await fixture.store.read(app.id)).toMatchObject({ status: 'ok' })
  })

  it('rejects a refresh and binding commit that used an application secret replaced in flight', async () => {
    const app = await fixture.store.create(applicationInput)
    const knowledge = new ExternalKnowledgeCredentialStore(fixture.store)
    const reference = randomUUID()
    await knowledge.put(reference, { ...applicationInput.payload, ...tokens })
    const before = await knowledge.read(reference)
    if (before.status !== 'ok') throw new Error('missing credential')
    await fixture.store.replaceApplication({ id: app.id, appSecret: 'replacement-secret' })
    expect(
      await knowledge.rotateTokens(reference, before.credential, { ...tokens, refreshToken: 'late-refresh' })
    ).toBe('stale')
    await expect(
      knowledge.commit(reference, before.credential, () =>
        connections.create({
          appId: before.credential.appId,
          appCredentialSource: 'custom-app',
          credentialReference: reference
        })
      )
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(connections.list()).toEqual([])
    expect(await knowledge.read(reference)).toMatchObject({
      status: 'ok',
      credential: { appSecret: 'replacement-secret', refreshToken: tokens.refreshToken }
    })
  })

  it('prevents deletion of a live grant and permits cleanup after releasing its database binding', async () => {
    const knowledge = new ExternalKnowledgeCredentialStore(fixture.store)
    const reference = randomUUID()
    await knowledge.put(reference, { ...applicationInput.payload, ...tokens })
    const connection = await knowledge.commit(reference, applicationInput.payload, () =>
      connections.create({
        appId: applicationInput.payload.appId,
        appCredentialSource: 'custom-app',
        credentialReference: reference
      })
    )
    await expect(knowledge.remove(reference)).rejects.toMatchObject({ code: 'in-use' })
    expect(await knowledge.read(reference)).toMatchObject({ status: 'ok' })
    await knowledge.remove(reference, () => {
      connections.remove(connection.id)
    })
    expect(connections.list()).toEqual([])
    expect(await knowledge.read(reference)).toEqual({ status: 'missing' })
  })

  it('does not recreate a selected application deleted during user authorization', async () => {
    const app = await fixture.store.create(applicationInput)
    const knowledge = new ExternalKnowledgeCredentialStore(fixture.store)
    const selected = await knowledge.readApplication(app.id)
    await fixture.store.remove(app.id, () => false)
    const reference = randomUUID()
    await expect(knowledge.put(reference, { ...selected, ...tokens })).rejects.toMatchObject({ code: 'conflict' })
    expect(await fixture.store.listSummaries()).toEqual([])
    expect(await knowledge.read(reference)).toEqual({ status: 'missing' })
  })
})
