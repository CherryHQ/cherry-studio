import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it } from 'vitest'

import { application } from '@application'
import { agentRuntimeBackendTable } from '@data/db/schemas/agentRuntimeBackend'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionContextTable } from '@data/db/schemas/agentSessionContext'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'

describe('native association transactions', () => {
  const dbh = setupTestDatabase()

  it('reuses an existing locator without promoting its unfinished native creation', () => {
    const locator = { version: 1, kind: 'pi-durable', fileName: 'original.sqlite' } as const
    const first = application.get('DbService').withWriteTx((tx) => contexts.ensureBackendTx(tx, locator, 'creating'))
    const repeated = application.get('DbService').withWriteTx((tx) => contexts.ensureBackendTx(tx, locator, 'bound'))
    expect(repeated.id).toBe(first.id)
    expect(repeated.state).toBe('creating')
    expect(dbh.db.select().from(agentRuntimeBackendTable).all()).toHaveLength(1)
  })

  it('rolls back the backend and context together when reservation fails', () => {
    dbh.db
      .insert(agentWorkspaceTable)
      .values({ id: 'workspace', name: 'Work', path: '/test', type: 'user', orderKey: 'a0' })
      .run()
    dbh.db
      .insert(agentSessionTable)
      .values({ id: 'session', workspaceId: 'workspace', name: 'Session', orderKey: 'a0' })
      .run()
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
})
