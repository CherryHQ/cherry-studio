import { resolve } from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

import { applyMigrations } from '@data/db/applyMigrations'

describe('skill note migrate-forward', () => {
  const dbh = setupTestDatabase({ beforeMigration: '0036_yummy_arclight' })

  it('preserves old skills and agent links and persists notes after reopening', () => {
    dbh.sqlite
      .prepare(
        "INSERT INTO agent (id, type, name, instructions, order_key, created_at, updated_at) VALUES ('agent', 'user', 'Agent', '', 'a0', 1, 1)"
      )
      .run()
    dbh.sqlite
      .prepare(
        "INSERT INTO agent_global_skill (id, name, folder_name, source, content_hash, created_at, updated_at) VALUES ('skill', 'Skill', 'skill', 'local', 'hash', 1, 1)"
      )
      .run()
    dbh.sqlite
      .prepare(
        "INSERT INTO agent_skill (agent_id, skill_id, is_enabled, created_at, updated_at) VALUES ('agent', 'skill', 1, 1, 1)"
      )
      .run()
    applyMigrations(dbh.db, resolve('migrations/sqlite-drizzle'))
    expect(dbh.sqlite.prepare('SELECT note FROM agent_global_skill').get()).toEqual({ note: null })
    expect(dbh.sqlite.prepare('SELECT agent_id, skill_id, is_enabled FROM agent_skill').get()).toEqual({
      agent_id: 'agent',
      skill_id: 'skill',
      is_enabled: 1
    })
    dbh.sqlite.prepare("UPDATE agent_global_skill SET note = 'Reminder' WHERE id = 'skill'").run()
    const file = (dbh.sqlite.pragma('database_list') as { file: string }[])[0].file
    dbh.sqlite.close()
    const reopened = new Database(file)
    expect(reopened.prepare('SELECT note FROM agent_global_skill').get()).toEqual({ note: 'Reminder' })
    reopened.close()
  })
})
