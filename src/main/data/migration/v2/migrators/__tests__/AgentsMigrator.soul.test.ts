/**
 * Focused test for the v1 → v2 soul/memory file copy.
 *
 * v1 conflated an agent's identity + memory with its working dir; v2 stores them
 * in a stable per-agent root (`{agentRootsDir}/{newId}`). The migrator copies each
 * legacy agent's on-disk SOUL/USER/memory from its old workspace
 * (`accessible_paths[0]`) into that root, keyed by the FINAL v2 agent id produced
 * by `remapAgentPrefixIds`.
 *
 * `migrateAgentSoulFiles` is module-private, so this exercises the exact same
 * sequence the migrator runs against a real DB + real fs: remap the legacy
 * prefix id (asserting the returned old→new Map), then copy via the real
 * `importIdentityAndMemory` into the remapped root, and assert the files land
 * under `{agentRootsDir}/{newId}`.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { agentTable } from '@data/db/schemas/agent'
import { agentRootPath, importIdentityAndMemory } from '@main/utils/agentRoot'
import { setupTestDatabase } from '@test-helpers/db'
import { sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { remapAgentPrefixIds } from '../remapAgentPrefixIds'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const LEGACY_AGENT_ID = 'agent_soul_001_abc'

describe('AgentsMigrator soul/memory copy', () => {
  const dbh = setupTestDatabase()
  let tempDir: string
  let legacyWorkspace: string
  let agentRootsDir: string

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'cs-agents-soul-test-'))
    legacyWorkspace = join(tempDir, 'legacy-workspace')
    agentRootsDir = join(tempDir, 'roots')
    mkdirSync(join(legacyWorkspace, 'memory'), { recursive: true })
    writeFileSync(join(legacyWorkspace, 'SOUL.md'), '# Soul\n\nWarm but direct.')
    writeFileSync(join(legacyWorkspace, 'memory', 'FACT.md'), '- Project: cherry-studio')

    // remapAgentPrefixIds runs inside the engine's migration-wide FK=OFF window.
    await dbh.db.run(sql`PRAGMA foreign_keys = OFF`)
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('copies SOUL.md and memory/FACT.md into {agentRootsDir}/{newId} after remap', async () => {
    await dbh.db.insert(agentTable).values({
      id: LEGACY_AGENT_ID,
      type: 'claude-code',
      name: 'Soul Agent',
      instructions: 'helper',
      model: null,
      orderKey: 'a0'
    })

    // The remap rewrites the legacy prefix id to a UUID and returns the old→new map
    // the soul/memory copy keys its destination root on.
    const idMap = await remapAgentPrefixIds(dbh.db)

    expect(idMap.size).toBe(1)
    const newId = idMap.get(LEGACY_AGENT_ID)
    expect(newId).toMatch(UUID_PATTERN)

    // Mirror migrateAgentSoulFiles: source = accessible_paths[0], dest = root for newId.
    const copied = await importIdentityAndMemory(legacyWorkspace, agentRootPath(agentRootsDir, newId!))
    expect(copied).toEqual(expect.arrayContaining(['SOUL.md', 'memory']))

    const root = agentRootPath(agentRootsDir, newId!)
    expect(existsSync(join(root, 'SOUL.md'))).toBe(true)
    expect(readFileSync(join(root, 'SOUL.md'), 'utf-8')).toContain('Warm but direct.')
    expect(existsSync(join(root, 'memory', 'FACT.md'))).toBe(true)
    expect(readFileSync(join(root, 'memory', 'FACT.md'), 'utf-8')).toContain('Project: cherry-studio')
  })
})
