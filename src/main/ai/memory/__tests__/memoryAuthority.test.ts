import { randomUUID } from 'node:crypto'

import { setupTestDatabase } from '@test-helpers/db'
import { MockApplicationUtils } from '@test-mocks/main/application'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { agentTable } from '@data/db/schemas/agent'
import { agentChannelSessionTable, agentChannelTable } from '@data/db/schemas/agentChannel'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { assistantTable } from '@data/db/schemas/assistant'
import { topicTable } from '@data/db/schemas/topic'
import { DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'

import { agentMemoryAuthority, assistantMemoryAuthority, editorMemoryAuthority } from '../memoryAuthority'

describe('memory authority from persistent owners', () => {
  const dbh = setupTestDatabase()
  let sessionId: string
  let agentId: string
  let assistantId: string
  let topicId: string
  let headless: boolean
  let active: boolean
  const turn = {
    isHeadless: () => headless,
    assertActive: (): undefined => {
      if (!active) throw new Error('Turn ended')
      return undefined
    }
  }

  beforeEach(() => {
    headless = false
    active = true
    agentId = randomUUID()
    sessionId = randomUUID()
    assistantId = randomUUID()
    topicId = randomUUID()
    const workspaceId = randomUUID()
    dbh.db.insert(agentTable).values({ id: agentId, type: 'pi', name: 'A', instructions: '', orderKey: 'a0' }).run()
    dbh.db.insert(agentWorkspaceTable).values({ id: workspaceId, name: 'W', path: '/workspace', orderKey: 'a0' }).run()
    dbh.db.insert(agentSessionTable).values({ id: sessionId, agentId, workspaceId, name: 'S', orderKey: 'a0' }).run()
    dbh.db
      .insert(assistantTable)
      .values({
        id: assistantId,
        name: 'Assistant',
        emoji: '🌟',
        settings: DEFAULT_ASSISTANT_SETTINGS,
        orderKey: 'a0'
      })
      .run()
    dbh.db.insert(topicTable).values({ id: topicId, assistantId, orderKey: 'a0' }).run()
  })

  afterEach(() => MockApplicationUtils.resetServices())

  it('defaults agents on and assistants off, without granting assistant private access', () => {
    expect(agentMemoryAuthority(sessionId, 'shared', turn).scope).toEqual({ kind: 'shared' })
    expect(agentMemoryAuthority(sessionId, 'private', turn).scope).toEqual({ kind: 'private', agentId })
    expect(() => assistantMemoryAuthority({ kind: 'conversation', topicId, assistantId }, turn)).toThrow()
    dbh.db
      .update(assistantTable)
      .set({ settings: { ...DEFAULT_ASSISTANT_SETTINGS, enableSharedMemory: true } })
      .run()
    expect(assistantMemoryAuthority({ kind: 'conversation', topicId, assistantId }, turn).scope).toEqual({
      kind: 'shared'
    })
  })

  it.each(['temporary', 'auxiliary', 'headless'] as const)(
    'rejects %s assistants even with a persistent topic and enabled switch',
    (kind) => {
      dbh.db
        .update(assistantTable)
        .set({ settings: { ...DEFAULT_ASSISTANT_SETTINGS, enableSharedMemory: true } })
        .run()
      expect(() => assistantMemoryAuthority({ kind, topicId, assistantId }, turn)).toThrow()
    }
  )

  it('rechecks disabling, deletion, owner changes, and turn liveness on an existing authority', () => {
    const shared = agentMemoryAuthority(sessionId, 'shared', turn)
    const privateScope = agentMemoryAuthority(sessionId, 'private', turn)
    dbh.db
      .update(agentTable)
      .set({ configuration: { shared_memory_enabled: false } })
      .run()
    expect(() => shared.assertAuthorized()).toThrow()
    expect(privateScope.assertAuthorized()).toBeUndefined()
    dbh.db.update(agentSessionTable).set({ agentId: null }).run()
    expect(() => privateScope.assertAuthorized()).toThrow()
    dbh.db.update(agentSessionTable).set({ agentId }).run()
    dbh.db.update(agentTable).set({ deletedAt: Date.now() }).run()
    expect(() => privateScope.assertAuthorized()).toThrow()
    active = false
    expect(() => privateScope.assertAuthorized()).toThrow('Turn ended')
  })

  it('never upgrades an external channel to shared access and binds private access to its owner', () => {
    const channelId = randomUUID()
    dbh.db
      .insert(agentChannelTable)
      .values({ id: channelId, name: 'C', type: 'telegram', agentId, workspace: { type: 'system' }, config: {} })
      .run()
    dbh.db.insert(agentChannelSessionTable).values({ sessionId, channelId }).run()
    expect(() => agentMemoryAuthority(sessionId, 'shared', turn)).toThrow()
    const authority = agentMemoryAuthority(sessionId, 'private', turn)
    expect(authority.scope).toEqual({ kind: 'private', agentId })
    dbh.db.update(agentChannelTable).set({ agentId: null }).where(eq(agentChannelTable.id, channelId)).run()
    expect(() => authority.assertAuthorized()).toThrow()
  })

  it('revokes desktop shared access when its session becomes a channel session or a headless turn', () => {
    const authority = agentMemoryAuthority(sessionId, 'shared', turn)
    headless = true
    expect(() => authority.assertAuthorized()).toThrow()
    headless = false
    const channelId = randomUUID()
    dbh.db
      .insert(agentChannelTable)
      .values({ id: channelId, name: 'C', type: 'telegram', agentId, workspace: { type: 'system' }, config: {} })
      .run()
    dbh.db.insert(agentChannelSessionTable).values({ sessionId, channelId }).run()
    expect(() => authority.assertAuthorized()).toThrow()
  })

  it('rechecks the assistant topic association and rejects removed topics', () => {
    dbh.db
      .update(assistantTable)
      .set({ settings: { ...DEFAULT_ASSISTANT_SETTINGS, enableSharedMemory: true } })
      .run()
    const authority = assistantMemoryAuthority({ kind: 'conversation', topicId, assistantId }, turn)
    dbh.db.update(topicTable).set({ assistantId: null }).run()
    expect(() => authority.assertAuthorized()).toThrow()
    dbh.db.update(topicTable).set({ assistantId, deletedAt: Date.now() }).run()
    expect(() => authority.assertAuthorized()).toThrow()
  })

  it('requires a live managed main window for editor operations', () => {
    let open = true
    MockApplicationUtils.setService('WindowManager', {
      getWindowType: (id: string) => (id === 'main' ? 'main' : 'quickAssistant'),
      getWindow: () => (open ? {} : undefined)
    })
    expect(() => editorMemoryAuthority(null, { kind: 'shared' })).toThrow()
    expect(() => editorMemoryAuthority('quick', { kind: 'shared' })).toThrow()
    const authority = editorMemoryAuthority('main', { kind: 'shared' })
    open = false
    expect(() => authority.assertAuthorized()).toThrow()
  })
})
