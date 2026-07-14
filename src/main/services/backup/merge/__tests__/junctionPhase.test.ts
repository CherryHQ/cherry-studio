// Junction phase tests — the global importAllJunctionRows pass for pure junction tables.
//
// Seeds AGENTS + SKILLS + MCP_SERVERS (all uuid-entity roots) and asserts the junction
// action matrix: both-endpoints-insert → import with canonical FKs; source-skip → cascade-
// prune; target-skip → import with local-canonical target; idempotent re-import; cross-domain
// agent_mcp_server; same-domain agent_channel_task.
//
// Mirrors MergeEngine.test setup: live test DB = merge base; backup = dbh.sqlite.backup().

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { contributorManager } from '@main/services/backup/contributors/ContributorManager'
import { setupTestDatabase } from '@test-helpers/db'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { MergeContext } from '..'
import { MergeEngine } from '..'

const dbh = setupTestDatabase()
const registry = contributorManager.getRegistry()

let tmpDir: string
let backupPath: string

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'cs-junction-'))
  backupPath = join(tmpDir, 'backup.sqlite')
  await dbh.sqlite.backup(backupPath)
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

const seedBackup = (seed: (db: Database.Database) => void): void => {
  const db = new Database(backupPath)
  try {
    db.pragma('foreign_keys = ON')
    db.transaction(seed)(db)
  } finally {
    db.close()
  }
}

/**
 * Insert a row, auto-filling NOT NULL columns that have no DB default with a type-appropriate
 * dummy (`0` for integer, `''` for text). `overrides` supplies PK + meaningful columns. This
 * keeps seeds stable across schema drift (new NOT NULL columns don't break the helper).
 */
const seedRow = (db: Database.Database, table: string, overrides: Record<string, unknown>): void => {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as {
    name: string
    type: string
    notnull: number
    dflt_value: string | null
  }[]
  const names: string[] = []
  const values: unknown[] = []
  for (const c of cols) {
    if (c.name in overrides) {
      names.push(c.name)
      values.push(overrides[c.name])
    } else if (c.notnull && c.dflt_value === null) {
      names.push(c.name)
      values.push(c.type === 'integer' ? 0 : '')
    }
  }
  const placeholders = names.map(() => '?').join(',')
  db.prepare(`INSERT INTO ${table} (${names.join(',')}) VALUES (${placeholders})`).run(...values)
}

const seedAgent = (db: Database.Database, id: string): void => {
  seedRow(db, 'agent', { id, type: 'agent', name: `a-${id}` })
}

const seedSkill = (db: Database.Database, id: string): void => {
  seedRow(db, 'agent_global_skill', {
    id,
    name: `s-${id}`,
    folder_name: `f-${id}`,
    source: 'builtin',
    content_hash: `h-${id}`
  })
}

const seedMcpServer = (db: Database.Database, id: string): void => {
  seedRow(db, 'mcp_server', { id, name: `m-${id}` })
}

const seedAgentSkill = (db: Database.Database, agentId: string, skillId: string): void => {
  seedRow(db, 'agent_skill', { agent_id: agentId, skill_id: skillId, is_enabled: 1 })
}

const seedAgentMcpServer = (db: Database.Database, agentId: string, mcpId: string): void => {
  seedRow(db, 'agent_mcp_server', { agent_id: agentId, mcp_server_id: mcpId })
}

const seedAgentChannel = (db: Database.Database, id: string): void => {
  seedRow(db, 'agent_channel', { id, type: 'telegram', name: `c-${id}` })
}

const seedJobSchedule = (db: Database.Database, id: string): void => {
  seedRow(db, 'job_schedule', { id, type: 'agent.task', name: `j-${id}` })
}

const seedAgentChannelTask = (db: Database.Database, channelId: string, taskId: string): void => {
  seedRow(db, 'agent_channel_task', { channel_id: channelId, task_id: taskId })
}

const runMerge = (ctx: MergeContext): Promise<unknown> =>
  new MergeEngine(registry).mergeBackupIntoWork(dbh.sqlite, dbh.db, ctx)

// SKILLS (agent_global_skill) and AGENTS (agent_workspace) hold natural-key aggregates → the
// SKIP override is mandatory (FIELD_MERGE is unimplemented). Under SKIP, conflicting roots
// remain local while missing uuid and natural-key roots are INSERTed and populate identityMap.
const agentsSkillsCtx = (): MergeContext => ({
  backupDbPath: backupPath,
  domains: ['AGENTS', 'SKILLS'],
  userStrategy: 'SKIP',
  skippedFileEntryIds: new Set<string>(), fileEntryRewrites: new Map()
})

const agentSkillRows = (): { agent_id: string; skill_id: string }[] =>
  dbh.sqlite.prepare(`SELECT agent_id, skill_id FROM agent_skill ORDER BY agent_id, skill_id`).all() as {
    agent_id: string
    skill_id: string
  }[]

describe('importAllJunctionRows (global junction phase)', () => {
  it('imports agent_skill when source is imported + target is local-canonical (SKIP)', async () => {
    // Work already has skill-1 (natural-key SKIP → targetMap carries local canonical 'skill-1').
    seedSkill(dbh.sqlite, 'skill-1')
    seedBackup((db) => {
      seedAgent(db, 'agent-1')
      seedSkill(db, 'skill-1')
      seedAgentSkill(db, 'agent-1', 'skill-1')
    })

    const result = await runMerge(agentsSkillsCtx())

    expect(result).toMatchObject({ degradedToSkips: [] })
    // agent-1 INSERTed (sourceMap) + skill-1 local-canonical (targetMap) → junction imported.
    expect(agentSkillRows()).toEqual([{ agent_id: 'agent-1', skill_id: 'skill-1' }])
  })

  it('cascade-prunes agent_skill when the source agent is not imported (work already has it)', async () => {
    // Work already has agent-1 (uuid SKIP → sourceMap stays empty) AND skill-1 (local-canonical).
    seedAgent(dbh.sqlite, 'agent-1')
    seedSkill(dbh.sqlite, 'skill-1')
    seedBackup((db) => {
      seedAgent(db, 'agent-1')
      seedSkill(db, 'skill-1')
      seedAgentSkill(db, 'agent-1', 'skill-1')
    })

    await runMerge(agentsSkillsCtx())

    // source agent-1 not imported this restore → cascade-prune (no junction row).
    expect(agentSkillRows()).toEqual([])
  })

  it('imports agent_skill when the target skill is backfilled by explicit SKIP', async () => {
    // Work has neither skill nor agent. Explicit SKIP INSERTs both missing roots, so the
    // source and target identity maps resolve the junction endpoints.
    seedBackup((db) => {
      seedAgent(db, 'agent-1')
      seedSkill(db, 'skill-1')
      seedAgentSkill(db, 'agent-1', 'skill-1')
    })

    await runMerge(agentsSkillsCtx())

    expect(agentSkillRows()).toEqual([{ agent_id: 'agent-1', skill_id: 'skill-1' }])
  })

  it('is idempotent — re-merging the same backup adds 0 new junction rows', async () => {
    seedSkill(dbh.sqlite, 'skill-1')
    seedBackup((db) => {
      seedAgent(db, 'agent-1')
      seedSkill(db, 'skill-1')
      seedAgentSkill(db, 'agent-1', 'skill-1')
    })

    await runMerge(agentsSkillsCtx())
    const afterFirst = agentSkillRows().length

    await runMerge(agentsSkillsCtx())
    const afterSecond = agentSkillRows().length

    expect(afterSecond).toBe(afterFirst)
  })

  it('imports agent_mcp_server across AGENTS + MCP_SERVERS (cross-domain, both uuid INSERTed)', async () => {
    seedBackup((db) => {
      seedAgent(db, 'agent-2')
      seedMcpServer(db, 'mcp-2')
      seedAgentMcpServer(db, 'agent-2', 'mcp-2')
    })

    const result = await runMerge({
      backupDbPath: backupPath,
      domains: ['AGENTS', 'MCP_SERVERS'],
      userStrategy: 'SKIP',
      skippedFileEntryIds: new Set<string>(), fileEntryRewrites: new Map()
    })

    expect(result).toMatchObject({ degradedToSkips: [] })
    const rows = dbh.sqlite.prepare(`SELECT agent_id, mcp_server_id FROM agent_mcp_server ORDER BY agent_id`).all() as {
      agent_id: string
      mcp_server_id: string
    }[]
    expect(rows).toEqual([{ agent_id: 'agent-2', mcp_server_id: 'mcp-2' }])
  })

  it('imports agent_channel_task (same-domain AGENTS junction) with local-canonical job_schedule', async () => {
    // job_schedule is natural-key (FIELD_MERGE) → under SKIP it force-skips. Pre-seed work with
    // the local canonical task-1 so the junction target resolves (targetMap local-canonical);
    // agent_channel (uuid) INSERTs as the source. Both legs are AGENTS — deriveJunctionDescriptors
    // picks agent_channel as source (first same-domain endpoint), job_schedule as target.
    seedJobSchedule(dbh.sqlite, 'task-1')
    seedBackup((db) => {
      seedAgentChannel(db, 'chan-1')
      seedJobSchedule(db, 'task-1')
      seedAgentChannelTask(db, 'chan-1', 'task-1')
    })

    const result = await runMerge({
      backupDbPath: backupPath,
      domains: ['AGENTS'],
      userStrategy: 'SKIP',
      skippedFileEntryIds: new Set<string>(), fileEntryRewrites: new Map()
    })

    expect(result).toMatchObject({ degradedToSkips: [] })
    const rows = dbh.sqlite.prepare(`SELECT channel_id, task_id FROM agent_channel_task`).all() as {
      channel_id: string
      task_id: string
    }[]
    expect(rows).toEqual([{ channel_id: 'chan-1', task_id: 'task-1' }])
  })
})
