import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { agentTable } from '@data/db/schemas/agent'
import { agentMcpServerTable } from '@data/db/schemas/assistantRelations'
import { mcpServerTable } from '@data/db/schemas/mcpServer'
import { setupTestDatabase } from '@test-helpers/db'
import Database from 'better-sqlite3'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { migrateAgentMcps } from '../AgentsMigrator'

const MALFORMED_AGENT_ID = 'agent-v1-malformed-mcps'
const VALID_AGENT_ID = 'agent-v1-valid-mcps'
const LEGACY_MCP_ID = 'legacy-mcp-valid'
const TARGET_MCP_ID = 'target-mcp-valid'

function seedLegacyAgentsDb(databasePath: string): void {
  const database = new Database(databasePath)
  try {
    database.exec('CREATE TABLE agents (id TEXT PRIMARY KEY, mcps TEXT)')
    const insert = database.prepare('INSERT INTO agents (id, mcps) VALUES (?, ?)')
    insert.run(MALFORMED_AGENT_ID, 'not-json')
    insert.run(VALID_AGENT_ID, JSON.stringify([LEGACY_MCP_ID]))
  } finally {
    database.close()
  }
}

describe('AgentsMigrator > migrateAgentMcps malformed legacy data', () => {
  const dbh = setupTestDatabase()
  let tempDir: string
  let legacyPath: string

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cs-agents-mcp-test-'))
    legacyPath = join(tempDir, 'agents.db')
    seedLegacyAgentsDb(legacyPath)
  })

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  beforeEach(() => {
    dbh.db
      .insert(agentTable)
      .values(
        [MALFORMED_AGENT_ID, VALID_AGENT_ID].map((id, index) => ({
          id,
          type: 'claude-code',
          name: id,
          instructions: 'test',
          model: null,
          orderKey: `a${index}`
        }))
      )
      .run()
    dbh.db.insert(mcpServerTable).values({ id: TARGET_MCP_ID, name: 'Migrated MCP' }).run()
  })

  it('skips malformed JSON without blocking valid associations', () => {
    dbh.db.run(sql.raw(`ATTACH DATABASE '${legacyPath}' AS agents_legacy`))
    try {
      expect(() => migrateAgentMcps(dbh.db, new Map([[LEGACY_MCP_ID, TARGET_MCP_ID]]))).not.toThrow()
    } finally {
      dbh.db.run(sql.raw('DETACH DATABASE agents_legacy'))
    }

    expect(dbh.db.select().from(agentMcpServerTable).all()).toEqual([
      expect.objectContaining({ agentId: VALID_AGENT_ID, mcpServerId: TARGET_MCP_ID })
    ])
  })
})
