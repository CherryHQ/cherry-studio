import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { createClient } from '@libsql/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { type AgentsSourceTableName, getAgentsSourceTableNames } from '../../migrators/mappings/AgentsDbMappings'
import { LegacyAgentsDbReader } from '../LegacyAgentsDbReader'

const TABLE_DDL: Record<AgentsSourceTableName, string> = {
  agents: 'CREATE TABLE agents (id TEXT PRIMARY KEY, name TEXT)',
  sessions: 'CREATE TABLE sessions (id TEXT PRIMARY KEY, agent_id TEXT)',
  skills: 'CREATE TABLE skills (id TEXT PRIMARY KEY, label TEXT)',
  agent_skills: 'CREATE TABLE agent_skills (agent_id TEXT, skill_id TEXT)',
  scheduled_tasks: 'CREATE TABLE scheduled_tasks (id TEXT PRIMARY KEY, schedule TEXT)',
  task_run_logs: 'CREATE TABLE task_run_logs (id TEXT PRIMARY KEY, task_id TEXT)',
  channels: 'CREATE TABLE channels (id TEXT PRIMARY KEY, name TEXT)',
  channel_task_subscriptions: 'CREATE TABLE channel_task_subscriptions (channel_id TEXT, task_id TEXT)',
  session_messages: 'CREATE TABLE session_messages (id TEXT PRIMARY KEY, session_id TEXT, content TEXT)'
}

async function buildLegacyAgentsDb(dbPath: string, tablesToCreate: readonly AgentsSourceTableName[]): Promise<void> {
  const client = createClient({ url: pathToFileURL(dbPath).href })
  try {
    // Ensures the SQLite file is materialized even when no tables are requested.
    await client.execute('SELECT 1')
    for (const tableName of tablesToCreate) {
      await client.execute(TABLE_DDL[tableName])
    }
  } finally {
    client.close()
  }
}

describe('LegacyAgentsDbReader', () => {
  describe('resolvePath', () => {
    it('returns the legacy agents db path when it exists', () => {
      const exists = vi.fn((p: unknown) => p === '/data/agents.db')
      const reader = new LegacyAgentsDbReader({ legacyAgentDbFile: '/data/agents.db' }, exists)

      expect(reader.resolvePath()).toBe('/data/agents.db')
      expect(exists).toHaveBeenCalledWith('/data/agents.db')
    })

    it('returns null when the legacy agents db does not exist', () => {
      const reader = new LegacyAgentsDbReader({ legacyAgentDbFile: '/data/agents.db' }, () => false)

      expect(reader.resolvePath()).toBeNull()
    })
  })

  describe('inspectSchema', () => {
    let tmpDir: string
    let dbPath: string

    beforeEach(() => {
      tmpDir = mkdtempSync(path.join(tmpdir(), 'cs-legacy-agents-'))
      dbPath = path.join(tmpDir, 'agents.db')
    })

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true })
    })

    it('returns empty schema info when the legacy db file is missing', async () => {
      const reader = new LegacyAgentsDbReader({ legacyAgentDbFile: dbPath }, () => false)
      const schema = await reader.inspectSchema()

      for (const tableName of getAgentsSourceTableNames()) {
        expect(schema[tableName].exists).toBe(false)
        expect(schema[tableName].columns.size).toBe(0)
      }
    })

    it('reports every source table as missing for a database with no agents tables', async () => {
      await buildLegacyAgentsDb(dbPath, [])
      const reader = new LegacyAgentsDbReader({ legacyAgentDbFile: dbPath })

      // This case is the original crash path: drizzle-orm/libsql .get() on a
      // raw SQL query that returns zero rows used to throw
      // "Cannot convert undefined or null to object" via Object.keys(undefined).
      const schema = await reader.inspectSchema()

      for (const tableName of getAgentsSourceTableNames()) {
        expect(schema[tableName].exists).toBe(false)
        expect(schema[tableName].columns.size).toBe(0)
      }
    })

    it('detects only the tables that exist when the legacy db is partially populated', async () => {
      await buildLegacyAgentsDb(dbPath, ['agents', 'sessions'])
      const reader = new LegacyAgentsDbReader({ legacyAgentDbFile: dbPath })

      const schema = await reader.inspectSchema()

      expect(schema.agents.exists).toBe(true)
      expect(schema.agents.columns).toEqual(new Set(['id', 'name']))
      expect(schema.sessions.exists).toBe(true)
      expect(schema.sessions.columns).toEqual(new Set(['id', 'agent_id']))

      const stillMissing: AgentsSourceTableName[] = [
        'skills',
        'agent_skills',
        'scheduled_tasks',
        'task_run_logs',
        'channels',
        'channel_task_subscriptions',
        'session_messages'
      ]
      for (const tableName of stillMissing) {
        expect(schema[tableName].exists).toBe(false)
        expect(schema[tableName].columns.size).toBe(0)
      }
    })

    it('detects all source tables when the legacy db is fully populated', async () => {
      const all = getAgentsSourceTableNames()
      await buildLegacyAgentsDb(dbPath, all)
      const reader = new LegacyAgentsDbReader({ legacyAgentDbFile: dbPath })

      const schema = await reader.inspectSchema()

      for (const tableName of all) {
        expect(schema[tableName].exists).toBe(true)
        expect(schema[tableName].columns.size).toBeGreaterThan(0)
      }
    })
  })

  describe('countRows', () => {
    let tmpDir: string
    let dbPath: string

    beforeEach(() => {
      tmpDir = mkdtempSync(path.join(tmpdir(), 'cs-legacy-agents-'))
      dbPath = path.join(tmpDir, 'agents.db')
    })

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true })
    })

    it('returns zero counts for tables that do not exist', async () => {
      await buildLegacyAgentsDb(dbPath, ['agents'])
      const reader = new LegacyAgentsDbReader({ legacyAgentDbFile: dbPath })

      const counts = await reader.countRows()

      expect(counts.agents).toBe(0)
      expect(counts.session_messages).toBe(0)
    })

    it('counts rows for tables that exist', async () => {
      await buildLegacyAgentsDb(dbPath, ['agents'])
      const seedClient = createClient({ url: pathToFileURL(dbPath).href })
      try {
        await seedClient.execute("INSERT INTO agents (id, name) VALUES ('a1', 'one')")
        await seedClient.execute("INSERT INTO agents (id, name) VALUES ('a2', 'two')")
      } finally {
        seedClient.close()
      }

      const reader = new LegacyAgentsDbReader({ legacyAgentDbFile: dbPath })
      const counts = await reader.countRows()

      expect(counts.agents).toBe(2)
    })
  })
})
