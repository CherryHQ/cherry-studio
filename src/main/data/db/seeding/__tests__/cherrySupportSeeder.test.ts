import { setupTestDatabase } from '@test-helpers/db'
import { eq, sql } from 'drizzle-orm'
import { app } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { CherryAiDefaultModelSeeder } from '@data/db/seeding/seeders/cherryaiDefaultModelSeeder'
import { CherryAssistantSeeder } from '@data/db/seeding/seeders/cherryAssistantSeeder'
import { CherrySupportSeeder } from '@data/db/seeding/seeders/cherrySupportSeeder'
import { BUILTIN_AGENT_ROLE, CHERRY_SUPPORT_AGENT_ID } from '@shared/ai/builtinAgent'
import { AGENT_WORKSPACE_TYPE } from '@shared/data/api/schemas/agentWorkspaces'
import { CHERRYAI_DEFAULT_UNIQUE_MODEL_ID } from '@shared/data/presets/cherryai'

function builtinAgents(db: ReturnType<typeof setupTestDatabase>['db'], role: string) {
  return db
    .select()
    .from(agentTable)
    .where(sql`json_extract(${agentTable.configuration}, '$.builtin_role') = ${role}`)
    .all()
}

describe('CherrySupportSeeder', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    vi.mocked(app.getPreferredSystemLanguages).mockReturnValue(['en-US'])
  })

  it('creates Cherry Support beside Cherry Assistant with a system session and copied model', () => {
    new CherryAiDefaultModelSeeder().run(dbh.db)
    new CherryAssistantSeeder().run(dbh.db)
    const [assistant] = builtinAgents(dbh.db, BUILTIN_AGENT_ROLE.ASSISTANT)
    dbh.db
      .update(agentTable)
      .set({ model: CHERRYAI_DEFAULT_UNIQUE_MODEL_ID })
      .where(eq(agentTable.id, assistant.id))
      .run()

    new CherrySupportSeeder().run(dbh.db)

    const [support] = builtinAgents(dbh.db, BUILTIN_AGENT_ROLE.SUPPORT)
    expect(support).toMatchObject({
      id: CHERRY_SUPPORT_AGENT_ID,
      name: 'Cherry Support',
      description: '',
      instructions: '',
      model: CHERRYAI_DEFAULT_UNIQUE_MODEL_ID
    })
    expect(support.configuration).toMatchObject({
      avatar: '🧰',
      permission_mode: 'acceptEdits',
      bootstrap_completed: true,
      builtin_role: BUILTIN_AGENT_ROLE.SUPPORT
    })
    expect(builtinAgents(dbh.db, BUILTIN_AGENT_ROLE.ASSISTANT)).toHaveLength(1)
    const [session] = dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.agentId, support.id)).all()
    const [workspace] = dbh.db
      .select()
      .from(agentWorkspaceTable)
      .where(eq(agentWorkspaceTable.id, session.workspaceId))
      .all()
    expect(session).toMatchObject({ name: '' })
    expect(workspace).toMatchObject({ type: AGENT_WORKSPACE_TYPE.SYSTEM })
  })

  it('uses the Chinese name and remains idempotent', () => {
    vi.mocked(app.getPreferredSystemLanguages).mockReturnValue(['zh-CN'])

    new CherrySupportSeeder().run(dbh.db)
    new CherrySupportSeeder().run(dbh.db)

    expect(builtinAgents(dbh.db, BUILTIN_AGENT_ROLE.SUPPORT)).toHaveLength(1)
    expect(builtinAgents(dbh.db, BUILTIN_AGENT_ROLE.SUPPORT)[0].name).toBe('产品反馈')
    expect(dbh.db.select().from(agentSessionTable).all()).toHaveLength(1)
  })

  it('updates the previous stock Chinese name without replacing a custom name', () => {
    new CherrySupportSeeder().run(dbh.db)
    dbh.db.update(agentTable).set({ name: 'Cherry 支持' }).where(eq(agentTable.id, CHERRY_SUPPORT_AGENT_ID)).run()

    new CherrySupportSeeder().run(dbh.db)
    expect(builtinAgents(dbh.db, BUILTIN_AGENT_ROLE.SUPPORT)[0].name).toBe('产品反馈')

    dbh.db.update(agentTable).set({ name: '我的反馈助手' }).where(eq(agentTable.id, CHERRY_SUPPORT_AGENT_ID)).run()
    new CherrySupportSeeder().run(dbh.db)

    expect(builtinAgents(dbh.db, BUILTIN_AGENT_ROLE.SUPPORT)[0].name).toBe('我的反馈助手')
  })

  it('claims an active reserved ID in place without replacing data or creating another session', () => {
    new CherrySupportSeeder().run(dbh.db)
    dbh.db
      .update(agentTable)
      .set({
        name: 'My Reserved Agent',
        instructions: 'Keep these instructions',
        configuration: { avatar: 'U', heartbeat_interval: 7 }
      })
      .where(eq(agentTable.id, CHERRY_SUPPORT_AGENT_ID))
      .run()

    new CherrySupportSeeder().run(dbh.db)

    const [support] = builtinAgents(dbh.db, BUILTIN_AGENT_ROLE.SUPPORT)
    expect(support).toMatchObject({
      id: CHERRY_SUPPORT_AGENT_ID,
      name: 'My Reserved Agent',
      instructions: 'Keep these instructions',
      configuration: { avatar: 'U', heartbeat_interval: 7, builtin_role: 'support' }
    })
    expect(dbh.db.select().from(agentSessionTable).all()).toHaveLength(1)
  })

  it('does not recreate a soft-deleted Cherry Support', () => {
    new CherrySupportSeeder().run(dbh.db)
    const [support] = builtinAgents(dbh.db, BUILTIN_AGENT_ROLE.SUPPORT)
    dbh.db
      .update(agentTable)
      .set({ deletedAt: Date.UTC(2026, 0, 1), configuration: { avatar: 'S' } })
      .where(eq(agentTable.id, support.id))
      .run()

    new CherrySupportSeeder().run(dbh.db)

    expect(builtinAgents(dbh.db, BUILTIN_AGENT_ROLE.SUPPORT)).toHaveLength(1)
    expect(builtinAgents(dbh.db, BUILTIN_AGENT_ROLE.SUPPORT)[0].deletedAt).not.toBeNull()
    expect(builtinAgents(dbh.db, BUILTIN_AGENT_ROLE.SUPPORT)[0].configuration).toEqual({
      avatar: 'S',
      builtin_role: 'support'
    })
    expect(dbh.db.select().from(agentSessionTable).all()).toHaveLength(1)
  })

  it('isolates a legacy forged role and preserves the ordinary Agent while creating official Support', () => {
    dbh.db
      .insert(agentTable)
      .values({
        id: 'ordinary-agent',
        type: 'claude-code',
        name: 'My Agent',
        instructions: 'Keep my instructions',
        model: null,
        orderKey: 'a0',
        configuration: { builtin_role: 'support', avatar: 'U', heartbeat_interval: 7 }
      })
      .run()

    new CherrySupportSeeder().run(dbh.db)

    const [ordinary] = dbh.db.select().from(agentTable).where(eq(agentTable.id, 'ordinary-agent')).all()
    expect(ordinary).toMatchObject({ name: 'My Agent', instructions: 'Keep my instructions' })
    expect(ordinary.configuration).toEqual({ avatar: 'U', heartbeat_interval: 7 })
    expect(builtinAgents(dbh.db, BUILTIN_AGENT_ROLE.SUPPORT)).toEqual([
      expect.objectContaining({ id: CHERRY_SUPPORT_AGENT_ID })
    ])
  })
})
