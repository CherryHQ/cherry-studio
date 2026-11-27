import { randomUUID } from 'node:crypto'

import { setupTestDatabase } from '@test-helpers/db'
import { beforeEach, describe, expect, it } from 'vitest'

import { application } from '@application'
import { agentRuntimeBackendTable } from '@data/db/schemas/agentRuntimeBackend'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionContextTable } from '@data/db/schemas/agentSessionContext'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'
import { preparePiBranch } from '@main/ai/runtime/pi/piContext'

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
    expect(dbh.db.select().from(agentSessionContextTable).all()).toEqual([])
  })

  it('reuses an existing locator without promoting its unfinished native creation', () => {
    const locator = { version: 1, kind: 'pi-durable', fileName: 'original.sqlite' } as const
    const first = application.get('DbService').withWriteTx((tx) => contexts.ensureBackendTx(tx, locator, 'creating'))
    const repeated = application.get('DbService').withWriteTx((tx) => contexts.ensureBackendTx(tx, locator, 'bound'))
    expect(repeated.id).toBe(first.id)
    expect(repeated.state).toBe('creating')
    expect(dbh.db.select().from(agentRuntimeBackendTable).all()).toHaveLength(1)
  })

  it('keeps a reserved identity pending, confirms it once, and rejects identity changes', () => {
    const backend = application
      .get('DbService')
      .withWriteTx((tx) => contexts.ensureBackendTx(tx, { version: 1, kind: 'pi' }, 'bound'))
    const reserved = preparePiBranch('session', undefined, 'native')
    expect(reserved).toMatchObject({ nativeThreadId: 'native', bindingState: 'pending' })
    expect(messages.hasRuntimeResumeToken('session', 'native')).toBe(false)
    expect(() => contexts.bindContext(reserved.id, 'different')).toThrow('identity cannot change')
    expect(contexts.context(reserved.id).bindingState).toBe('pending')
    contexts.bindContext(reserved.id, 'native')
    expect(messages.hasRuntimeResumeToken('session', 'native')).toBe(true)
    expect(contexts.context(reserved.id)).toMatchObject({
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
  // Native numeric IDs are local to each store; publishing one edit cannot rebind an older context.
  it('publishes only the selected context when another backend has the same native ID', () => {
    const first = messages.saveMessage({ sessionId: 'session', message: { role: 'user', data: { parts: [] } } })
    const original = contexts.reserveBranchTx(dbh.db, {
      sessionId: 'session',
      backendId: contexts.ensureBackendTx(dbh.db, { version: 1, kind: 'pi-durable', fileName: 'old.sqlite' }, 'bound')
        .id,
      anchorMessageId: first.id,
      nativeThreadId: '2',
      checkpointMapping: { fork: { old: 'retained' } }
    })
    contexts.bindContext(original.id, '2')
    const edited = messages.saveMessage({ sessionId: 'session', message: { role: 'user', data: { parts: [] } } })
    const target = contexts.reserveBranchTx(dbh.db, {
      sessionId: 'session',
      backendId: contexts.ensureBackendTx(dbh.db, { version: 1, kind: 'pi-durable', fileName: 'new.sqlite' }, 'bound')
        .id,
      anchorMessageId: edited.id,
      nativeThreadId: '2'
    })
    expect(messages.hasRuntimeResumeToken('session', '2', target.id)).toBe(false)
    expect(messages.hasRuntimeResumeToken('session', '2', randomUUID())).toBe(false)
    contexts.publishBranchTx(dbh.db, 'session', '2', { edited: 'new checkpoint' })
    expect(contexts.context(original.id).checkpointMapping).toEqual({ fork: { old: 'retained' } })
    expect(contexts.context(target.id)).toMatchObject({
      bindingState: 'bound',
      checkpointMapping: { fork: { edited: 'new checkpoint' } }
    })
    expect(messages.hasRuntimeResumeToken('session', '2', target.id)).toBe(true)
  })
})
