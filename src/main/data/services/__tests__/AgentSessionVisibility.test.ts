import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { agentSessionHandlers } from '@data/api/handlers/agentSessions'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { pinTable } from '@data/db/schemas/pin'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { ErrorCode } from '@shared/data/api/errors'

const { notify } = vi.hoisted(() => ({ notify: vi.fn() }))
vi.mock('@data/dataApiDataChange', () => ({ notifyDataApiDataChange: notify }))

describe('background session isolation', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    dbh.db
      .insert(agentTable)
      .values({ id: 'agent', type: 'claude-code', name: 'Agent', instructions: '', orderKey: 'a0' })
      .run()
    notify.mockClear()
  })

  function create(name: string, type: 'conversation' | 'background' = 'conversation') {
    return agentSessionService.create({ agentId: 'agent', name, workspace: { type: 'system' } }, type)
  }

  it('excludes background rows before pin pagination and latest selection, including orphaned sessions', () => {
    const first = create('first')
    const second = create('second')
    const background = create('background', 'background')
    const unpinnedBackground = create('unpinned background', 'background')
    dbh.db
      .insert(pinTable)
      .values([
        { id: 'pin-background', entityType: 'session', entityId: background.id, orderKey: 'a0' },
        { id: 'pin-conversation', entityType: 'session', entityId: first.id, orderKey: 'a1' }
      ])
      .run()
    dbh.db
      .update(agentSessionTable)
      .set({ lastActivityAt: Date.now() + 60_000 })
      .where(eq(agentSessionTable.type, 'background'))
      .run()
    dbh.db
      .update(agentSessionTable)
      .set({ lastActivityAt: Date.now() + 1_000 })
      .where(eq(agentSessionTable.id, second.id))
      .run()

    const ids: string[] = []
    let cursor: string | undefined
    do {
      const page = agentSessionService.listByCursor({ limit: 1, cursor })
      ids.push(...page.items.map((row) => row.id))
      cursor = page.nextCursor
    } while (cursor)
    expect(ids).toEqual([first.id, second.id])
    expect(agentSessionService.getLatestActive()?.id).toBe(second.id)
    expect(agentSessionService.listByCursor({ agentId: 'agent' }).items.map((row) => row.id)).toEqual(ids)

    dbh.db.update(agentSessionTable).set({ agentId: null }).run()
    expect(agentSessionService.getLatestActive({ agentId: 'unlinked' })?.id).toBe(second.id)
    expect(agentSessionService.getById(background.id).id).toBe(background.id)
    expect(agentSessionService.getById(unpinnedBackground.id).id).toBe(unpinnedBackground.id)
  })

  it('rejects a background ID at the conversation API while retaining internal execution access', async () => {
    const background = create('heartbeat', 'background')
    await expect(
      agentSessionHandlers['/agent-sessions/:sessionId'].GET({ params: { sessionId: background.id } })
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })
    expect(agentSessionService.getById(background.id).id).toBe(background.id)
    expect(agentSessionService.getLatestActive()).toBeNull()
    const conversation = create('conversation')
    await expect(
      agentSessionHandlers['/agent-sessions/:sessionId'].GET({ params: { sessionId: conversation.id } })
    ).resolves.toMatchObject({ id: conversation.id })
  })

  it('does not reuse or delete an empty background session as an interactive placeholder', () => {
    const background = create('', 'background')
    const placeholder = agentSessionService.reuseOrCreatePlaceholderForDelivery({
      agentId: 'agent',
      workspace: { type: 'system' }
    })
    expect(placeholder.created).toBe(true)
    expect(placeholder.session.id).not.toBe(background.id)
    expect(agentSessionService.getById(background.id).id).toBe(background.id)
    expect(agentSessionService.listByCursor().items.map((row) => row.id)).toEqual([placeholder.session.id])
  })

  it('excludes background metadata and message results from discovery, including short-term search', () => {
    const conversation = create('needle 项目')
    const background = create('needle 项目', 'background')
    for (const session of [conversation, background]) {
      dbh.db
        .insert(agentSessionMessageTable)
        .values({
          id: crypto.randomUUID(),
          sessionId: session.id,
          role: 'user',
          data: { parts: [{ type: 'text', text: 'needle 项目' }] },
          searchableText: 'needle 项目',
          status: 'success'
        })
        .run()
    }
    expect(agentSessionService.search({ q: 'needle', limit: 10 }).map((row) => row.id)).toEqual([conversation.id])
    expect(agentSessionService.listAddressableByCursor({}).items.map((row) => row.sessionId)).toEqual([conversation.id])
    for (const q of ['needle', '项']) {
      expect(agentSessionMessageService.search({ q }).items.map((row) => row.sessionId)).toEqual([conversation.id])
      expect(agentSessionMessageService.searchRanked({ q }).map((row) => row.sessionId)).toEqual([conversation.id])
    }
  })

  it('does not invalidate conversation navigation when a background session is created or receives a message', () => {
    const background = create('background', 'background')
    agentSessionMessageService.saveMessage(
      {
        sessionId: background.id,
        message: {
          id: crypto.randomUUID(),
          role: 'user',
          status: 'success',
          data: { parts: [{ type: 'text', text: 'check' }] }
        }
      },
      { publishDataChange: true }
    )
    const effects = notify.mock.calls.flatMap(([effects]) => effects)
    expect(effects.some((effect) => effect.endpoint === '/agent-sessions/:sessionId/messages')).toBe(true)
    expect(effects.filter((effect) => ['/agent-sessions', '/agent-sessions/latest'].includes(effect.endpoint))).toEqual(
      []
    )
  })
})
