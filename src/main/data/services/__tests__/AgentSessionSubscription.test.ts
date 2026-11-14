import '@data/services/AgentGlobalSkillService'
import '@data/services/AgentSessionMessageService'
import { resolve } from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { agentSessionService } from '@data/services/AgentSessionService'
import { providerRegistryService } from '@data/services/ProviderRegistryService'

describe('Claude subscription session allocation', () => {
  const dbh = setupTestDatabase()
  const workspace = { type: 'user', workspaceId: 'work' } as const

  beforeEach(() => {
    const getPath = vi.mocked(application.getPath).getMockImplementation()
    vi.spyOn(application, 'getPath').mockImplementation((key, filename) =>
      key === 'feature.provider_registry.data' && filename
        ? resolve(process.cwd(), 'packages/provider-registry/data', filename)
        : (getPath?.(key, filename) ?? `/mock/${key}`)
    )
    providerRegistryService.clearCache()
    dbh.db
      .insert(agentWorkspaceTable)
      .values({ id: 'work', type: 'user', path: '/work', name: 'Work', orderKey: 'a0' })
      .run()
    for (const [providerId, presetProviderId] of [
      ['login', 'claude-code'],
      ['api', 'anthropic']
    ]) {
      dbh.db.insert(userProviderTable).values({ providerId, presetProviderId, name: providerId, orderKey: 'a0' }).run()
      dbh.db
        .insert(userModelTable)
        .values({
          id: `${providerId}::sonnet`,
          providerId,
          modelId: 'sonnet',
          name: 'Sonnet',
          capabilities: [],
          supportsStreaming: true,
          orderKey: 'a0'
        })
        .run()
    }
    dbh.db
      .insert(agentTable)
      .values({
        id: 'agent',
        type: 'pi-durable',
        name: 'Agent',
        instructions: '',
        model: 'login::sonnet',
        orderKey: 'a0'
      })
      .run()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    providerRegistryService.clearCache()
  })

  it('binds interactive and background subscription sessions to Claude before native context allocation', () => {
    for (const type of ['conversation', 'background'] as const) {
      const session = agentSessionService.create({ agentId: 'agent', name: 'Subscription', workspace }, type)
      expect(session.runtimeType).toBe('claude-code')
      expect(agentSessionService.getRuntimeType(session.id)).toBe('claude-code')
      const child = dbh.db.transaction((tx) => agentSessionService.createChildArchiveTx(tx, session.id, 'Child'))
      expect(agentSessionService.getRuntimeType(child)).toBe('claude-code')
    }
    expect(dbh.db.select().from(agentTable).get()?.type).toBe('pi-durable')
  })

  it('uses Durable for API models without changing existing subscription sessions', () => {
    const original = agentSessionService.create({ agentId: 'agent', name: 'Subscription', workspace })
    dbh.db.update(agentTable).set({ model: 'api::sonnet' }).where(eq(agentTable.id, 'agent')).run()
    const next = agentSessionService.create({ agentId: 'agent', name: 'API', workspace })
    expect(agentSessionService.getRuntimeType(next.id)).toBe('pi-durable')
    expect(agentSessionService.getRuntimeType(original.id)).toBe('claude-code')
  })

  it('does not reuse or delete an empty conversation belonging to the previous model runtime', () => {
    const subscription = agentSessionService.reuseOrCreatePlaceholderWithImpact({ agentId: 'agent', workspace })
    dbh.db.update(agentTable).set({ model: 'api::sonnet' }).where(eq(agentTable.id, 'agent')).run()
    const api = agentSessionService.reuseOrCreatePlaceholderWithImpact({ agentId: 'agent', workspace })
    expect(api.session.id).not.toBe(subscription.session.id)
    expect(api.session.runtimeType).toBe('pi-durable')
    dbh.db.update(agentTable).set({ model: 'login::sonnet' }).where(eq(agentTable.id, 'agent')).run()
    const reused = agentSessionService.reuseOrCreatePlaceholderWithImpact({ agentId: 'agent', workspace })
    expect(reused.session.id).toBe(subscription.session.id)
    expect(reused.session.runtimeType).toBe('claude-code')
    expect(dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, api.session.id)).get()).toBeDefined()
  })

  it.each([
    ['api::sonnet', 'login::sonnet', 'pi-durable'],
    ['login::sonnet', 'api::sonnet', 'claude-code']
  ] as const)('allocates from session model %s instead of Agent default %s', (model, agentModel, runtimeType) => {
    dbh.db.update(agentTable).set({ model: agentModel }).where(eq(agentTable.id, 'agent')).run()
    const session = agentSessionService.create({ agentId: 'agent', name: 'Override', model, workspace })
    expect(session.model).toBe(model)
    expect(agentSessionService.getRuntimeType(session.id)).toBe(runtimeType)
  })

  it('keeps the subscription override and native runtime when an orphan adopts a Durable Agent', () => {
    const session = agentSessionService.create({
      agentId: 'agent',
      name: 'Retained subscription',
      model: 'login::sonnet',
      workspace
    })
    dbh.db.delete(agentTable).where(eq(agentTable.id, 'agent')).run()
    dbh.db
      .insert(agentTable)
      .values({
        id: 'replacement',
        type: 'pi-durable',
        name: 'Replacement',
        instructions: '',
        model: 'api::sonnet',
        orderKey: 'a0'
      })
      .run()
    const recovered = agentSessionService.update(session.id, { agentId: 'replacement' })
    expect(recovered.model).toBe('login::sonnet')
    expect(agentSessionService.getRuntimeType(session.id)).toBe('claude-code')
  })
})
