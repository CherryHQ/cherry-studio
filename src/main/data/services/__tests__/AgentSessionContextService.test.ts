import { setupTestDatabase } from '@test-helpers/db'
import { beforeEach, describe, expect, it } from 'vitest'

import { application } from '@application'
import { agentRuntimeBackendTable } from '@data/db/schemas/agentRuntimeBackend'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionContextTable } from '@data/db/schemas/agentSessionContext'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'

describe('native association transactions', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    dbh.db
      .insert(agentWorkspaceTable)
      .values({ id: 'workspace', name: 'Work', path: '/test', type: 'user', orderKey: 'a0' })
      .run()
    dbh.db
      .insert(agentSessionTable)
      .values({ id: 'session', workspaceId: 'workspace', name: 'Session', orderKey: 'a0' })
      .run()
  })

  it('does not infer a native backend from an archived checkpoint', () => {
    const saved = messages.saveMessage({
      sessionId: 'session',
      runtimeResumeToken: 'native',
      runtimeAnchor: { checkpoint: { runtime: 'pi', runtimeSessionId: 'native', leafId: 'leaf' } },
      message: { role: 'assistant', status: 'success', data: { parts: [{ type: 'text', text: 'Retained answer' }] } }
    })
    expect(messages.getSessionMessage('session', saved.id).data.parts).toEqual([
      { type: 'text', text: 'Retained answer' }
    ])
    expect(dbh.db.select().from(agentRuntimeBackendTable).all()).toEqual([])
    expect(contexts.forSession('session')).toEqual([])
  })

  it('reuses an existing locator without promoting its unfinished native creation', () => {
    const locator = { version: 1, kind: 'pi-durable', fileName: 'original.sqlite' } as const
    const first = application.get('DbService').withWriteTx((tx) => contexts.ensureBackendTx(tx, locator, 'creating'))
    const repeated = application.get('DbService').withWriteTx((tx) => contexts.ensureBackendTx(tx, locator, 'bound'))
    expect(repeated.id).toBe(first.id)
    expect(repeated.state).toBe('creating')
    expect(dbh.db.select().from(agentRuntimeBackendTable).all()).toHaveLength(1)
  })

  it('rolls back the backend and context together when reservation fails', () => {
    expect(() =>
      application.get('DbService').withWriteTx((tx) => {
        const backend = contexts.ensureBackendTx(tx, { version: 1, kind: 'pi' }, 'bound')
        contexts.allocateContextTx(tx, 'session', backend.id, 'native')
        throw new Error('reservation failed')
      })
    ).toThrow('reservation failed')
    expect(dbh.db.select().from(agentRuntimeBackendTable).all()).toEqual([])
    expect(dbh.db.select().from(agentSessionContextTable).all()).toEqual([])
  })

  it('keeps a reserved identity pending, confirms it once, and rejects identity changes', () => {
    dbh.db
      .insert(agentWorkspaceTable)
      .values({ id: 'workspace', name: 'Work', path: '/test', type: 'user', orderKey: 'a0' })
      .run()
    dbh.db
      .insert(agentSessionTable)
      .values({ id: 'session', workspaceId: 'workspace', name: 'Session', orderKey: 'a0' })
      .run()
    const backend = application
      .get('DbService')
      .withWriteTx((tx) => contexts.ensureBackendTx(tx, { version: 1, kind: 'pi' }, 'bound'))
    const reserved = contexts.allocateContext('session', backend.id, 'native')
    expect(reserved).toMatchObject({ nativeThreadId: 'native', bindingState: 'pending' })
    expect(contexts.allocateContext('session', backend.id, 'native').id).toBe(reserved.id)
    expect(() => contexts.bindContext(reserved.id, 'different')).toThrow('identity cannot change')
    expect(contexts.context(reserved.id).bindingState).toBe('pending')
    contexts.bindContext(reserved.id, 'native')
    expect(contexts.allocateContext('session', backend.id, 'native')).toMatchObject({
      id: reserved.id,
      nativeThreadId: 'native',
      bindingState: 'bound'
    })
    expect(() => contexts.bindContext(reserved.id, 'different')).toThrow('identity cannot change')
    expect(dbh.db.select().from(agentSessionContextTable).all()).toHaveLength(1)
    expect(() =>
      dbh.db
        .insert(agentSessionContextTable)
        .values({ sessionId: 'session', backendId: backend.id, bindingState: 'bound' })
        .run()
    ).toThrow()
  })
})
