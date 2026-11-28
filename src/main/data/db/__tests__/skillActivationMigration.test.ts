import { setupTestDatabase } from '@test-helpers/db'
import { resolveMigrationsPath } from '@test-helpers/db/internal/migrationsPath'
import { describe, expect, it } from 'vitest'

import { applyMigrations } from '@data/db/applyMigrations'
import { agentTable } from '@data/db/schemas/agent'
import { agentSkillTable } from '@data/db/schemas/agentSkill'
import { agentGlobalSkillService } from '@data/services/AgentGlobalSkillService'

describe('skill activation migration', () => {
  const dbh = setupTestDatabase({ beforeMigration: '0044_skill_activation_state' })

  it('requires confirmation for legacy adoptions while preserving global switches and Agent bindings', () => {
    const skills = [
      ['adopted-off', 'local', null, 0, 'pending'],
      ['adopted-on', 'local', null, 1, 'pending'],
      ['builtin', 'builtin', null, 1, 'active'],
      ['directory-import', 'local', 'file:///imports/skill', 1, 'active'],
      ['marketplace', 'marketplace', 'https://example.com/skill', 0, 'active'],
      ['system', 'system', 'file:///system/skill', 1, 'active'],
      ['zip-import', 'zip', 'file:///imports/skill.zip', 1, 'active']
    ] as const
    const insertSkill = dbh.sqlite.prepare(
      `INSERT INTO agent_global_skill
       (id, name, folder_name, source, source_url, content_hash, is_enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'hash', ?, 1, 2)`
    )
    for (const [id, source, sourceUrl, isEnabled] of skills) {
      insertSkill.run(id, id, id, source, sourceUrl, isEnabled)
    }
    dbh.db
      .insert(agentTable)
      .values(
        ['unbound', 'opted-in', 'opted-out'].map((id, index) => ({
          id,
          type: 'pi-durable' as const,
          name: id,
          instructions: '',
          orderKey: `a${index}`
        }))
      )
      .run()
    dbh.db
      .insert(agentSkillTable)
      .values([
        { agentId: 'opted-in', skillId: 'adopted-on', isEnabled: true, createdAt: 3, updatedAt: 4 },
        { agentId: 'opted-out', skillId: 'adopted-on', isEnabled: false, createdAt: 5, updatedAt: 6 },
        { agentId: 'opted-in', skillId: 'marketplace', isEnabled: true, createdAt: 7, updatedAt: 8 }
      ])
      .run()
    const readSkills = () =>
      dbh.sqlite.prepare<[], Record<string, unknown>>('SELECT * FROM agent_global_skill ORDER BY id').all()
    const readBindings = () => dbh.sqlite.prepare('SELECT * FROM agent_skill ORDER BY agent_id, skill_id').all()
    const before = readSkills()
    const bindings = readBindings()

    const migrations = resolveMigrationsPath()
    applyMigrations(dbh.db, migrations)

    expect(readSkills()).toEqual(before.map((row, index) => ({ ...row, activation_state: skills[index][4] })))
    expect(readBindings()).toEqual(bindings)
    expect(dbh.sqlite.pragma('foreign_key_check')).toEqual([])
    const isAdoptedEnabledFor = (agentId: string) =>
      agentGlobalSkillService.list({ agentId }).find((skill) => skill.id === 'adopted-on')?.isEnabled
    expect(['unbound', 'opted-in', 'opted-out'].map(isAdoptedEnabledFor)).toEqual([false, true, false])

    agentGlobalSkillService.updateGlobalEnabled('adopted-on', true)
    expect(isAdoptedEnabledFor('unbound')).toBe(true)
    const confirmed = readSkills()

    applyMigrations(dbh.db, migrations)
    expect(readSkills()).toEqual(confirmed)
    expect(readBindings()).toEqual(bindings)
    expect(dbh.sqlite.pragma('foreign_key_check')).toEqual([])
  })
})
