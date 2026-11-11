import { resolve } from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it } from 'vitest'

import { applyMigrations } from '@data/db/applyMigrations'

// The generated-role constraint change rebuilds two populated tables. Existing
// references, message bytes and the main branch's task-ownership migration survive.
describe('generated image reference migrate-forward', () => {
  const dbh = setupTestDatabase({ beforeMigration: '0038_fancy_kabuki' })

  it('preserves attachment/tool-output refs, accepts generated refs and keeps FK cleanup', () => {
    dbh.sqlite.exec(`
      INSERT INTO agent_workspace (id,name,path,order_key,created_at,updated_at)
      VALUES ('workspace','Workspace','/generated-refs','a0',1,2);
      INSERT INTO agent_session (id,name,workspace_id,order_key,last_activity_at,created_at,updated_at)
      VALUES ('session','Session','workspace','a0',1,1,2);
      INSERT INTO agent_session_message (id,session_id,role,data,status,created_at,updated_at)
      VALUES ('agent-message','session','assistant','{"parts":[{"type":"text","text":"keep"}]}','success',1,2);
      INSERT INTO topic (id,name,order_key,last_activity_at,created_at,updated_at)
      VALUES ('topic','Topic','a0',1,1,2);
      INSERT INTO message (id,topic_id,role,data,status,created_at,updated_at)
      VALUES ('root','topic','root','{"parts":[]}','success',1,2);
      INSERT INTO message (id,parent_id,topic_id,role,data,status,created_at,updated_at)
      VALUES ('chat-message','root','topic','assistant','{"parts":[{"type":"text","text":"keep"}]}','success',1,2);
      INSERT INTO file_entry (id,origin,name,ext,size,cleanup_policy,created_at,updated_at)
      VALUES ('file','internal','kept','png',3,'delete_when_unreferenced',1,2);
      INSERT INTO agent_session_message_file_ref (id,file_entry_id,source_id,role,created_at,updated_at)
      VALUES ('a','file','agent-message','attachment',10,20);
      INSERT INTO chat_message_file_ref (id,file_entry_id,source_id,role,created_at,updated_at)
      VALUES ('c','file','chat-message','attachment',10,20),('t','file','chat-message','tool_output',11,21);
    `)
    const tables = ['agent_session_message_file_ref', 'chat_message_file_ref']
    const before = tables.map((table) => dbh.sqlite.prepare(`SELECT * FROM ${table} ORDER BY id`).all())
    const messages = ['agent_session_message', 'message'].map((table) =>
      dbh.sqlite.prepare(`SELECT id,data,created_at,updated_at FROM ${table}`).all()
    )
    const insert = (table: string, id: string, source: string, role: string) =>
      dbh.sqlite
        .prepare(`INSERT INTO ${table} (id,file_entry_id,source_id,role,created_at,updated_at)
        VALUES (?,'file',?,?,30,40)`)
        .run(id, source, role)
    expect(() => insert(tables[0], 'ag', 'agent-message', 'generated')).toThrow()
    expect(() => insert(tables[1], 'cg', 'chat-message', 'generated')).toThrow()

    applyMigrations(dbh.db, resolve('migrations/sqlite-drizzle'))
    expect(tables.map((table) => dbh.sqlite.prepare(`SELECT * FROM ${table} ORDER BY id`).all())).toEqual(before)
    expect(
      ['agent_session_message', 'message'].map((table) =>
        dbh.sqlite.prepare(`SELECT id,data,created_at,updated_at FROM ${table}`).all()
      )
    ).toEqual(messages)
    expect(
      dbh.sqlite.prepare("SELECT name FROM pragma_table_info('agent_session') WHERE name = 'task_id'").get()
    ).toEqual({ name: 'task_id' })
    insert(tables[0], 'ag', 'agent-message', 'generated')
    insert(tables[1], 'cg', 'chat-message', 'generated')
    expect(() => insert(tables[0], 'bad', 'agent-message', 'unknown')).toThrow()
    expect(() => insert(tables[1], 'bad', 'chat-message', 'unknown')).toThrow()
    applyMigrations(dbh.db, resolve('migrations/sqlite-drizzle'))
    expect(dbh.sqlite.prepare('SELECT COUNT(*) AS count FROM chat_message_file_ref').get()).toEqual({ count: 3 })
    dbh.sqlite.prepare('DELETE FROM agent_session_message WHERE id=?').run('agent-message')
    expect(dbh.sqlite.prepare('SELECT COUNT(*) AS count FROM agent_session_message_file_ref').get()).toEqual({
      count: 0
    })
    dbh.sqlite.prepare('DELETE FROM file_entry WHERE id=?').run('file')
    expect(dbh.sqlite.prepare('SELECT COUNT(*) AS count FROM chat_message_file_ref').get()).toEqual({ count: 0 })
    expect(dbh.sqlite.pragma('foreign_key_check')).toEqual([])
    expect(dbh.sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(dbh.sqlite.pragma('integrity_check', { simple: true })).toBe('ok')
  })
})
