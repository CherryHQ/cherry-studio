/**
 * e2e-restore B1 roundtrip — workstream B1 (identity propagation).
 *
 * AC: `__tests__/e2e/restore.b1.roundtrip.test.ts`
 *
 * Exercises the B1 identity-propagation milestone end-to-end against work.sqlite:
 * - seed: local natural-key conflicts + cross-aggregate owning FKs + required JSON
 *   entity-ids
 * - export → admit → restore merge → verify work.sqlite (no promote — promotion is
 *   the relaunch+preboot responsibility covered by restorePromotion.test.ts).
 *
 * Per B1 R1 P1-4: the e2e verifies work.sqlite state, not the live DB (promotion
 * requires a relaunch; unit harness cannot fork processes). The setup mirrors
 * the `restore.full.test.ts` production-shape (seeder + cross-domain FKs) so the
 * B1 cross-aggregate owning FK + JSON entity-id rewrites are exercised on a
 * realistic fixture.
 *
 * What this test proves:
 * 1. agent_session.workspaceId is rewritten from the backup uuid to the local
 *    canonical PK (R1 P0-1) — pre-B1 this row was silently pruned.
 * 2. agent_channel.workspace.workspaceId is rewritten through the discriminated
 *    union walker (R1 P0-4) — pre-B1 this id was silently dangling.
 * 3. The whole-graph `foreign_key_check` + `integrity_check` remain clean.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { application } from '@application'
import { setBackupInProgress } from '@main/data/db/backup/quiesceGate'
import { snapshotTo } from '@main/data/db/restore/snapshot'
import { userProviderTable } from '@main/data/db/schemas/userProvider'
import type { DbType, ISeeder } from '@main/data/db/types'
import { contributorManager } from '@main/services/backup/contributors/ContributorManager'
import { setupTestDatabase } from '@test-helpers/db'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MergeEngine } from '../../merge/MergeEngine'

/** Minimal production-shaped seeder: preset openai row (no registry file dependency). */
const b1Seeder: ISeeder = {
  name: 'e2e-b1-openai',
  version: '1',
  description: 'openai provider placeholder mimicking PresetProviderSeeder',
  run(db: DbType): void {
    db.insert(userProviderTable)
      .values({
        providerId: 'openai',
        name: 'OpenAI',
        isEnabled: true,
        orderKey: 'o-seed-openai'
      })
      .onConflictDoNothing()
      .run()
  }
}

const DOMAINS = ['PREFERENCES', 'PROVIDERS', 'TAGS_GROUPS', 'AGENTS', 'TOPICS'] as const

describe('e2e-restore B1 roundtrip (identity propagation)', () => {
  // Production seeders + B1 fixtures layered on top — mirrors the production
  // shape from restore.full.test.ts so the B1 cross-aggregate FKs and JSON
  // entity-id columns are exercised on a realistic dataset.
  const dbh = setupTestDatabase({ seeders: [b1Seeder] })
  const registry = contributorManager.getRegistry()

  let tmpDir: string
  let stagingRoot: string
  let liveDbPath: string
  let backupDbPath: string

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cs-e2e-b1-'))
    stagingRoot = join(tmpDir, 'restore-staging')
    liveDbPath = dbh.sqlite.name
    backupDbPath = join(tmpDir, 'backup.sqlite')
    await dbh.sqlite.backup(backupDbPath)
    setBackupInProgress(false)

    vi.spyOn(application, 'getPath').mockImplementation((key: string) => {
      switch (key) {
        case 'feature.backup.restore.staging':
          return stagingRoot
        case 'app.userdata':
          return tmpDir
        case 'app.database.file':
          return liveDbPath
        default:
          return join(tmpDir, key)
      }
    })
  })

  afterEach(() => {
    setBackupInProgress(false)
    vi.restoreAllMocks()
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
  })

  /**
   * Insert a row, auto-filling NOT NULL columns that have no DB default with a
   * type-appropriate dummy. Mirrors the helper in restore.full.test.ts so the
   * fixtures stay stable across schema drift.
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
        names.push(`"${c.name}"`)
        values.push(overrides[c.name])
      } else if (c.notnull && c.dflt_value === null) {
        names.push(`"${c.name}"`)
        values.push(c.type === 'integer' ? 0 : '')
      }
    }
    db.prepare(`INSERT INTO ${table} (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`).run(...values)
  }

  /**
   * Seed the B1 fixture: agent_workspace natural-key conflict (path UNIQUE
   * collides) + agent_session referencing the backup uuid + agent_channel
   * embedding the backup uuid via the required JSON entity-id soft ref.
   */
  const seedB1Conflict = (db: Database.Database): void => {
    const now = Date.now()
    // agent
    seedRow(db, 'agent', { id: 'agent-1', type: 'agent', name: 'agent', instructions: 'do things' })
    // workspace conflict: same path /Users/me/proj, different uuids (FIELD_MERGE)
    seedRow(db, 'agent_workspace', {
      id: 'ws-backup',
      name: 'proj',
      path: '/Users/me/proj',
      type: 'user',
      order_key: 'o-w1'
    })
    // session referencing the BACKUP workspace uuid — B1 rewrites to local canonical
    seedRow(db, 'agent_session', {
      id: 'sess-1',
      agent_id: 'agent-1',
      name: 'session',
      workspace_id: 'ws-backup',
      order_key: 'o-s1'
    })
    // channel embedding the BACKUP workspace uuid via the required JSON entity-id
    db.prepare(
      `INSERT INTO agent_channel (id, type, name, agent_id, session_id, workspace, config, is_active, active_chat_ids, permission_mode, created_at, updated_at)
       VALUES (?, 'telegram', ?, NULL, NULL, ?, '{}', 1, '[]', NULL, ?, ?)`
    ).run('ch-1', 'c-1', JSON.stringify({ type: 'user', workspaceId: 'ws-backup' }), now, now)
  }

  it('roundtrips a workspace-conflict archive through the merge with no silent session loss + workspaceId rewritten', async () => {
    // Seed a local workspace under 'ws-local' (the canonical survivor) at the
    // same path /Users/me/proj — mirrors the production conflict shape.
    seedRow(dbh.sqlite, 'agent_workspace', {
      id: 'ws-local',
      name: 'proj-local',
      path: '/Users/me/proj',
      type: 'user',
      order_key: 'o-lw1'
    })
    // Seed the B1 fixture into the backup snapshot.
    const db = new Database(backupDbPath)
    try {
      db.pragma('foreign_keys = ON')
      db.transaction(seedB1Conflict)(db)
    } finally {
      db.close()
    }

    // Run the merge against a fresh work snapshot — D-model (B1 R1 P1-4):
    // verify the work.sqlite state directly. Promotion is relaunch's job.
    const workPath = join(stagingRoot, 'rst-e2e-b1', 'work.sqlite')
    snapshotTo(dbh.sqlite, workPath)
    const workSqlite = new Database(workPath)
    try {
      const workDb = drizzle({ client: workSqlite, casing: 'snake_case' })
      const result = await new MergeEngine(registry).mergeBackupIntoWork(workSqlite, workDb, {
        backupDbPath,
        domains: [...DOMAINS],
        skippedFileEntryIds: new Set<string>(),
        stagedFileEntryIds: new Set<string>()
      })

      // (1) Workspace FIELD_MERGE — local PK survives, backup uuid pruned.
      expect(workSqlite.prepare(`SELECT id FROM agent_workspace WHERE id='ws-local'`).get()).toBeDefined()
      expect(workSqlite.prepare(`SELECT id FROM agent_workspace WHERE id='ws-backup'`).get()).toBeUndefined()

      // (2) Session preserved + workspaceId rewritten to the local canonical PK.
      // Pre-B1: the session was silently pruned because workspaceId='ws-backup'
      // could not resolve. B1 rewrites it to 'ws-local' and the row lands.
      const sess = workSqlite.prepare(`SELECT workspace_id FROM agent_session WHERE id='sess-1'`).get() as
        | { workspace_id: string }
        | undefined
      expect(sess).toBeDefined()
      expect(sess?.workspace_id).toBe('ws-local')

      // (3) Channel embedded workspaceId rewritten through the discriminated
      // union walker. Pre-B1: the embedded id silently dangled (no hard FK
      // to validate it, no JSON walker to rewrite it).
      const ch = workSqlite.prepare(`SELECT workspace FROM agent_channel WHERE id='ch-1'`).get() as
        | { workspace: string }
        | undefined
      expect(ch).toBeDefined()
      const parsed = JSON.parse(ch!.workspace) as Record<string, unknown>
      expect(parsed.type).toBe('user')
      expect(parsed.workspaceId).toBe('ws-local')

      // (4) The whole-graph FK check + integrity check are the final arbiters.
      // Both must be clean — B1 is not allowed to relax either consistency gate.
      expect(workSqlite.pragma('foreign_key_check')).toEqual([])
      expect(workSqlite.pragma('integrity_check', { simple: true })).toBe('ok')

      // (5) Resolvable conflict does NOT show up in degradedToSkips as a
      // degradation (the row was rewritten, not pruned / SET NULL'd).
      // Note: agent_session's INSERT itself is not a degradation; field-merge
      // workspaces may still disclose if their specific merge policy surfaced
      // a field_conflict, but the B1 owning-FK rewrite is silent on success.
      const sessPrune = result.degradedToSkips.filter(
        (d) => d.table === 'agent_session' && d.reason.includes('owning ref')
      )
      expect(sessPrune).toEqual([])
    } finally {
      workSqlite.close()
    }
  })
})
