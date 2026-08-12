import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { CherryAiDefaultModelSeeder } from '@data/db/seeding/seeders/cherryaiDefaultModelSeeder'
import { CherryAssistantSeeder } from '@data/db/seeding/seeders/cherryAssistantSeeder'
import { CherrySupportSeeder } from '@data/db/seeding/seeders/cherrySupportSeeder'
import { BUILTIN_AGENT_ROLE } from '@shared/ai/builtinAgent'
import { AGENT_WORKSPACE_TYPE } from '@shared/data/api/schemas/agentWorkspaces'
import { CHERRYAI_DEFAULT_UNIQUE_MODEL_ID } from '@shared/data/presets/cherryai'
import { setupTestDatabase } from '@test-helpers/db'
import { eq, sql } from 'drizzle-orm'
import { app } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
      name: 'Cherry Support',
      description: '',
      instructions: '',
      model: CHERRYAI_DEFAULT_UNIQUE_MODEL_ID
    })
    expect(support.configuration).toMatchObject({
      avatar: '🧰',
      permission_mode: 'acceptEdits',
      max_turns: 100,
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
    expect(builtinAgents(dbh.db, BUILTIN_AGENT_ROLE.SUPPORT)[0].name).toBe('Cherry 支持')
    expect(dbh.db.select().from(agentSessionTable).all()).toHaveLength(1)
  })

  it('does not recreate a soft-deleted Cherry Support', () => {
    new CherrySupportSeeder().run(dbh.db)
    const [support] = builtinAgents(dbh.db, BUILTIN_AGENT_ROLE.SUPPORT)
    dbh.db
      .update(agentTable)
      .set({ deletedAt: Date.UTC(2026, 0, 1) })
      .where(eq(agentTable.id, support.id))
      .run()

    new CherrySupportSeeder().run(dbh.db)

    expect(builtinAgents(dbh.db, BUILTIN_AGENT_ROLE.SUPPORT)).toHaveLength(1)
    expect(builtinAgents(dbh.db, BUILTIN_AGENT_ROLE.SUPPORT)[0].deletedAt).not.toBeNull()
    expect(dbh.db.select().from(agentSessionTable).all()).toHaveLength(1)
  })
})
