import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { copyMigrationPrefix, resolveMigrationsPath } from '@test-helpers/db/internal/migrationsPath'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
// Frozen older startup must run its migrator without reinstalling current compatibility triggers.
// eslint-disable-next-line @typescript-eslint/no-restricted-imports
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { beforeEach, describe, expect, it } from 'vitest'

import { applyMigrations } from '@data/db/applyMigrations'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { AGENT_SESSION_MESSAGE_FTS_STATEMENTS } from '@data/db/schemas/agentSessionMessage'
import { MESSAGE_FTS_STATEMENTS } from '@data/db/schemas/message'
import '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import '@data/services/AgentTaskService'

// Frozen full-row SELECT emitted by the v2.1.10 schema (including its literal column order).
const oldSelect = `select "id", "type", "agent_id", "name", "is_name_manually_edited", "description", "workspace_id", "task_schedule_id", "trace_id", "order_key", "last_activity_at", "created_at", "updated_at", "deleted_at" from "agent_session"`
const oldSession = sqliteTable('agent_session', {
  id: text().primaryKey(),
  name: text().notNull(),
  workspaceId: text().notNull(),
  taskScheduleId: text(),
  orderKey: text().notNull(),
  lastActivityAt: integer().notNull(),
  createdAt: integer().notNull(),
  updatedAt: integer().notNull()
})

function seed(sqlite: ReturnType<typeof setupTestDatabase>['sqlite']) {
  sqlite.exec(`INSERT INTO agent_workspace (id,name,path,order_key,created_at,updated_at)
    VALUES ('w','Workspace','/compat','a',10,20);
    INSERT INTO job_schedule (id,type,name,trigger,job_input_template,catch_up_policy,created_at,updated_at)
    VALUES ('t','agent.task','Task','{}','{}','{}',10,20), ('u','agent.task','Other','{}','{}','{}',10,20);`)
}

for (const recursive of ['OFF', 'ON']) {
  describe(`fixed-build-first downgrade, recursive_triggers=${recursive}`, () => {
    const dbh = setupTestDatabase()
    const oldDb = () => drizzle({ client: dbh.sqlite, casing: 'snake_case' })
    const insertOld = (id: string, taskScheduleId: string | null = 't') =>
      oldDb()
        .insert(oldSession)
        .values({
          id,
          name: id,
          workspaceId: 'w',
          taskScheduleId,
          orderKey: id,
          lastActivityAt: 30,
          createdAt: 10,
          updatedAt: 20
        })
        .run()
    const read = () =>
      dbh.sqlite
        .prepare('SELECT id, task_id, is_task_reuse_target, task_schedule_id FROM agent_session ORDER BY id')
        .all()
    const check = () => {
      expect(dbh.sqlite.pragma('foreign_key_check')).toEqual([])
      expect(dbh.sqlite.pragma('integrity_check', { simple: true })).toBe('ok')
      expect(
        dbh.sqlite
          .prepare(`SELECT id FROM agent_session WHERE task_schedule_id IS NOT
        CASE WHEN is_task_reuse_target = 1 THEN task_id ELSE NULL END`)
          .all()
      ).toEqual([])
    }
    beforeEach(() => {
      dbh.sqlite.pragma(`recursive_triggers=${recursive}`)
      seed(dbh.sqlite)
    })

    it('reads the frozen full-row query after a canonical insert', () => {
      dbh.db
        .insert(agentSessionTable)
        .values({ id: 'new', name: 'New', workspaceId: 'w', orderKey: 'a', taskId: 't', isTaskReuseTarget: true })
        .run()
      expect(dbh.sqlite.prepare(oldSelect).all()).toEqual([
        expect.objectContaining({ id: 'new', task_schedule_id: 't' })
      ])
      check()
    })
    it('keeps an unbound older conversation unowned', () => {
      insertOld('plain', null)
      expect(read()).toEqual([{ id: 'plain', task_id: null, is_task_reuse_target: 0, task_schedule_id: null }])
      check()
    })
    it('normalizes old inserts, replacement and clearing without changing payload or timestamps', () => {
      insertOld('old')
      expect(dbh.db.select().from(agentSessionTable).get()).toMatchObject({ taskId: 't', isTaskReuseTarget: true })
      oldDb().update(oldSession).set({ taskScheduleId: 'u' }).where(eq(oldSession.id, 'old')).run()
      expect(read()).toEqual([{ id: 'old', task_id: 'u', is_task_reuse_target: 1, task_schedule_id: 'u' }])
      oldDb().update(oldSession).set({ taskScheduleId: null }).where(eq(oldSession.id, 'old')).run()
      expect(read()).toEqual([{ id: 'old', task_id: 'u', is_task_reuse_target: 0, task_schedule_id: null }])
      expect(dbh.sqlite.prepare(oldSelect).get()).toMatchObject({
        name: 'old',
        order_key: 'old',
        created_at: 10,
        updated_at: 20,
        last_activity_at: 30,
        deleted_at: null
      })
      check()
    })
    it('projects only reusable history and follows canonical reuse changes', () => {
      for (const [id, reuse] of [
        ['a-history', false],
        ['b-reuse', true]
      ] as const) {
        dbh.db
          .insert(agentSessionTable)
          .values({ id, name: id, workspaceId: 'w', orderKey: id, taskId: 't', isTaskReuseTarget: reuse })
          .run()
      }
      expect(
        dbh.sqlite
          .prepare(`${oldSelect} ORDER BY id`)
          .all()
          .map((r) => (r as { task_schedule_id: string | null }).task_schedule_id)
      ).toEqual([null, 't'])
      dbh.db
        .update(agentSessionTable)
        .set({ isTaskReuseTarget: false })
        .where(eq(agentSessionTable.id, 'b-reuse'))
        .run()
      dbh.db
        .update(agentSessionTable)
        .set({ isTaskReuseTarget: true })
        .where(eq(agentSessionTable.id, 'a-history'))
        .run()
      expect(read()).toEqual([
        { id: 'a-history', task_id: 't', is_task_reuse_target: 1, task_schedule_id: 't' },
        { id: 'b-reuse', task_id: 't', is_task_reuse_target: 0, task_schedule_id: null }
      ])
      check()
    })
    it('converges canonical and legacy UPSERT conflict updates', () => {
      insertOld('upsert', null)
      dbh.sqlite.exec(`INSERT INTO agent_session
        (id,name,workspace_id,order_key,last_activity_at,created_at,updated_at,task_id,is_task_reuse_target)
        VALUES ('upsert','Upsert','w','a',30,10,20,'t',1)
        ON CONFLICT(id) DO UPDATE SET task_id=excluded.task_id, is_task_reuse_target=excluded.is_task_reuse_target`)
      expect(read()).toEqual([{ id: 'upsert', task_id: 't', is_task_reuse_target: 1, task_schedule_id: 't' }])
      check()
      dbh.sqlite.exec(`INSERT INTO agent_session
        (id,name,workspace_id,order_key,last_activity_at,created_at,updated_at,task_schedule_id)
        VALUES ('upsert','Upsert','w','a',30,10,20,'u')
        ON CONFLICT(id) DO UPDATE SET task_schedule_id=excluded.task_schedule_id`)
      expect(read()).toEqual([{ id: 'upsert', task_id: 'u', is_task_reuse_target: 1, task_schedule_id: 'u' }])
      check()
    })
    it('converges demotion and promotion within one multi-row statement', () => {
      insertOld('a')
      insertOld('b', null)
      dbh.sqlite.exec(`UPDATE agent_session SET task_id='t',
        is_task_reuse_target=CASE WHEN id='b' THEN 1 ELSE 0 END WHERE id IN ('a','b')`)
      expect(read()).toEqual([
        { id: 'a', task_id: 't', is_task_reuse_target: 0, task_schedule_id: null },
        { id: 'b', task_id: 't', is_task_reuse_target: 1, task_schedule_id: 't' }
      ])
      check()
    })
    it('commits release and rebind together and rolls back a legacy unique violation', () => {
      insertOld('a')
      insertOld('b', null)
      dbh.sqlite.transaction(() => {
        dbh.sqlite.exec("UPDATE agent_session SET is_task_reuse_target=0 WHERE id='a'")
        dbh.sqlite.exec("UPDATE agent_session SET task_id='t', is_task_reuse_target=1 WHERE id='b'")
      })()
      expect(read()).toEqual([
        { id: 'a', task_id: 't', is_task_reuse_target: 0, task_schedule_id: null },
        { id: 'b', task_id: 't', is_task_reuse_target: 1, task_schedule_id: 't' }
      ])
      check()
      oldDb().update(oldSession).set({ taskScheduleId: 'u' }).where(eq(oldSession.id, 'a')).run()
      expect(() =>
        dbh.sqlite.transaction(() => {
          dbh.sqlite.exec("UPDATE agent_session SET is_task_reuse_target=0 WHERE id='b'")
          dbh.sqlite.exec("UPDATE agent_session SET task_schedule_id='u' WHERE id='b'")
        })()
      ).toThrow(
        expect.objectContaining({
          code: 'SQLITE_CONSTRAINT_UNIQUE',
          message: expect.stringContaining('task_schedule_id')
        })
      )
      expect(read()).toEqual([
        { id: 'a', task_id: 'u', is_task_reuse_target: 1, task_schedule_id: 'u' },
        { id: 'b', task_id: 't', is_task_reuse_target: 1, task_schedule_id: 't' }
      ])
      check()
    })
    it('clears the reassigned projection on trash and ownership on restore', () => {
      insertOld('a')
      insertOld('b', null)
      dbh.sqlite.transaction(() => {
        dbh.sqlite.exec("UPDATE agent_session SET is_task_reuse_target=0 WHERE id='a'")
        dbh.sqlite.exec("UPDATE agent_session SET task_id='t', is_task_reuse_target=1 WHERE id='b'")
      })()
      expect(read()).toEqual([
        { id: 'a', task_id: 't', is_task_reuse_target: 0, task_schedule_id: null },
        { id: 'b', task_id: 't', is_task_reuse_target: 1, task_schedule_id: 't' }
      ])
      agentSessionService.deleteByIds(['b'])
      expect(read()).toEqual([
        { id: 'a', task_id: 't', is_task_reuse_target: 0, task_schedule_id: null },
        { id: 'b', task_id: 't', is_task_reuse_target: 0, task_schedule_id: null }
      ])
      expect(
        dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, 'b')).get()?.deletedAt
      ).not.toBeNull()
      check()
      agentSessionService.restore('b')
      expect(read()).toEqual([
        { id: 'a', task_id: 't', is_task_reuse_target: 0, task_schedule_id: null },
        { id: 'b', task_id: null, is_task_reuse_target: 0, task_schedule_id: null }
      ])
      expect(dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, 'b')).get()?.deletedAt).toBeNull()
      check()
    })
    it('rejects duplicate sticky bindings and invalid tasks atomically', () => {
      insertOld('first')
      expect(() => insertOld('duplicate')).toThrow(expect.objectContaining({ code: 'SQLITE_CONSTRAINT_UNIQUE' }))
      expect(() => insertOld('invalid', 'absent')).toThrow(
        expect.objectContaining({ code: 'SQLITE_CONSTRAINT_FOREIGNKEY' })
      )
      expect(read()).toEqual([{ id: 'first', task_id: 't', is_task_reuse_target: 1, task_schedule_id: 't' }])
      check()
    })
    it('allows frozen schedule deletion and rolls the whole change back on failure', () => {
      insertOld('old')
      expect(() =>
        dbh.sqlite.transaction(() => {
          dbh.sqlite.exec("DELETE FROM job_schedule WHERE id='t'")
          throw new Error('rollback')
        })()
      ).toThrow('rollback')
      expect(read()).toEqual([{ id: 'old', task_id: 't', is_task_reuse_target: 1, task_schedule_id: 't' }])
      expect(() => dbh.sqlite.exec("DELETE FROM job_schedule WHERE id='t'")).not.toThrow()
      expect(read()).toEqual([{ id: 'old', task_id: null, is_task_reuse_target: 0, task_schedule_id: null }])
      check()
    })
    it('survives two production startups followed by the frozen older startup path', () => {
      insertOld('old')
      const before = dbh.sqlite.prepare(oldSelect).all()
      applyMigrations(dbh.db, resolveMigrationsPath())
      applyMigrations(dbh.db, resolveMigrationsPath())
      const folder = mkdtempSync(join(tmpdir(), 'compat-old-startup-'))
      try {
        // The old path is migrate(prefix through 0029), then the unchanged FTS statements.
        dbh.sqlite.pragma('foreign_keys = OFF')
        try {
          migrate(oldDb(), { migrationsFolder: copyMigrationPrefix(folder, '0030_skill_mirror_export') })
        } finally {
          dbh.sqlite.pragma('foreign_keys = ON')
        }
        for (const statement of [...MESSAGE_FTS_STATEMENTS, ...AGENT_SESSION_MESSAGE_FTS_STATEMENTS])
          dbh.sqlite.exec(statement)
      } finally {
        rmSync(folder, { recursive: true, force: true })
      }
      expect(dbh.sqlite.prepare(oldSelect).all()).toEqual(before)
      oldDb().update(oldSession).set({ taskScheduleId: null }).run()
      expect(read()).toEqual([{ id: 'old', task_id: 't', is_task_reuse_target: 0, task_schedule_id: null }])
      check()
    })
  })
}

describe('populated released baseline migrate-forward', () => {
  describe('0029 baseline', () => {
    const dbh = setupTestDatabase({ beforeMigration: '0030_skill_mirror_export' })
    it('preserves old binding, message payload and timestamps through the full chain', () => {
      seed(dbh.sqlite)
      dbh.sqlite
        .exec(`INSERT INTO agent_session (id,name,workspace_id,task_schedule_id,order_key,last_activity_at,created_at,updated_at)
      VALUES ('s','Session','w','t','a',30,10,20);
      INSERT INTO agent_session_message (id,session_id,role,data,status,created_at,updated_at)
      VALUES ('m','s','user','{"parts":[]}','success',40,50);`)
      const before = dbh.sqlite.prepare(oldSelect).all()
      const message = dbh.sqlite
        .prepare('SELECT id,session_id,data,created_at,updated_at FROM agent_session_message')
        .all()
      applyMigrations(dbh.db, resolveMigrationsPath())
      expect(dbh.sqlite.prepare(oldSelect).all()).toEqual(before)
      expect(
        dbh.sqlite.prepare('SELECT id,session_id,data,created_at,updated_at FROM agent_session_message').all()
      ).toEqual(message)
      expect(dbh.sqlite.prepare('SELECT task_id,is_task_reuse_target FROM agent_session').get()).toEqual({
        task_id: 't',
        is_task_reuse_target: 1
      })
      expect(dbh.sqlite.pragma('foreign_key_check')).toEqual([])
      expect(dbh.sqlite.pragma('integrity_check', { simple: true })).toBe('ok')
      expect(
        dbh.sqlite
          .prepare(
            `SELECT id FROM agent_session WHERE task_schedule_id IS NOT CASE WHEN is_task_reuse_target=1 THEN task_id ELSE NULL END`
          )
          .all()
      ).toEqual([])
    })
  })
  describe('mixed ownership before 0037_agent_avatar', () => {
    const dbh = setupTestDatabase({ beforeMigration: '0037_agent_avatar' })
    it('preserves mixed ownership, payloads, references and timestamps through 0038', () => {
      seed(dbh.sqlite)
      dbh.sqlite.exec(`INSERT INTO agent (id,type,name,instructions,order_key,created_at,updated_at)
        VALUES ('agent','claude-code','Agent','','a',11,21);
        INSERT INTO agent_session
          (id,agent_id,name,workspace_id,task_id,is_task_reuse_target,order_key,last_activity_at,created_at,updated_at)
        VALUES ('a-plain','agent','Plain','w',NULL,0,'a',31,12,22),
          ('b-history','agent','History','w','t',0,'b',32,13,23),
          ('c-reuse','agent','Reuse','w','t',1,'c',33,14,24);
        INSERT INTO agent_session_message (id,session_id,role,data,status,created_at,updated_at)
        VALUES ('m','b-history','user','{"parts":[{"type":"text","text":"keep me"}]}','success',40,50);
        INSERT INTO file_entry (id,origin,name,ext,size,cleanup_policy,created_at,updated_at)
        VALUES ('file','internal','Attachment','txt',7,'manual',41,51);
        INSERT INTO agent_session_message_file_ref (id,file_entry_id,source_id,role,created_at,updated_at)
        VALUES ('ref','file','m','attachment',42,52);`)
      const sessions = dbh.sqlite.prepare('SELECT * FROM agent_session ORDER BY id').all()
      const tables = [
        'agent',
        'agent_workspace',
        'job_schedule',
        'agent_session_message',
        'file_entry',
        'agent_session_message_file_ref'
      ]
      const before = tables.map((table) => dbh.sqlite.prepare(`SELECT * FROM ${table} ORDER BY id`).all())
      applyMigrations(dbh.db, resolveMigrationsPath())
      expect(dbh.sqlite.prepare('SELECT task_schedule_id FROM agent_session ORDER BY id').all()).toEqual([
        { task_schedule_id: null },
        { task_schedule_id: null },
        { task_schedule_id: 't' }
      ])
      expect(dbh.sqlite.prepare('SELECT * FROM agent_session ORDER BY id').all()).toEqual(
        sessions.map((row, index) => ({
          ...(row as Record<string, unknown>),
          task_schedule_id: index === 2 ? 't' : null
        }))
      )
      for (const [index, table] of tables.entries()) {
        expect(dbh.sqlite.prepare(`SELECT * FROM ${table} ORDER BY id`).all()).toEqual(before[index])
      }
      expect(dbh.sqlite.pragma('foreign_key_check')).toEqual([])
      expect(dbh.sqlite.pragma('integrity_check', { simple: true })).toBe('ok')
      expect(
        dbh.sqlite
          .prepare(`SELECT id FROM agent_session WHERE task_schedule_id IS NOT
          CASE WHEN is_task_reuse_target=1 THEN task_id ELSE NULL END`)
          .all()
      ).toEqual([])
    })
  })
})
