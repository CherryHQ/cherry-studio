// t2 — Cross-machine agent_workspace.path rebase (restore side). agent_workspace is
// a natural-key aggregate whose identityKey is `path` (UNIQUE non-PK, §6.2). The path
// stores a MACHINE-SPECIFIC absolute dir:
//   - system workspace (type='system'): managed, {userData}/Data/Agents/system/{YYYY-MM-DD}/{sessionId}
//   - user workspace (type='user'): an arbitrary absolute dir the user picked
//
// On a cross-machine restore the backup's path (/Users/a/...) never byte-matches the
// host's path (/Users/b/...) → identity lookup misses → backup workspace INSERTs as a
// DUPLICATE (instead of merging into the host's same-named workspace) → t4's workspaceId
// rewrite has no anchor → required refs discard.
//
// The engine rewrites the backup row's path to the host's managed system-workspaces dir
// BEFORE identity lookup (so cross-machine workspaces match by their portable tail):
//   - system: the /system/{YYYY-MM-DD}/{sessionId} tail → joined under the host's
//     feature.agents.system_workspaces root (faithful — system ws is managed).
//   - user: basename → {hostSystemWorkspacesRoot}/{basename} (a placeholder — the user's
//     custom dir isn't carried by the archive) + disclosure (content missing on host).
//
// This file reproduces the cross-machine identity miss + the unjoinable write before fix.

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { contributorManager } from '@main/services/backup/contributors/ContributorManager'
import { setupTestDatabase } from '@test-helpers/db'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { MergeEngine } from '../MergeEngine'
import type { MergeContext } from '../types'

describe('MergeEngine cross-machine agent_workspace.path rebase (t2)', () => {
  const dbh = setupTestDatabase()
  const registry = contributorManager.getRegistry()

  let tmpDir: string
  let backupPath: string
  let hostSystemWorkspacesRoot: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'cs-merge-ws-'))
    backupPath = join(tmpDir, 'backup.sqlite')
    hostSystemWorkspacesRoot = join(tmpDir, 'host-system-ws')
    await dbh.sqlite.backup(backupPath)
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  /** Seed the synthetic backup.sqlite with raw rows in one tx (FK enforcement ON). */
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
   * Insert an agent_workspace row. `path` defaults to a MACHINE-SPECIFIC absolute dir
   * (production form) — system ws under the backup machine's Agents/system tree, user
   * ws under an arbitrary absolute dir.
   */
  const insertWorkspace = (
    db: Database.Database,
    id: string,
    path: string,
    opts: { type?: 'system' | 'user'; name?: string } = {}
  ): void => {
    const type = opts.type ?? 'user'
    const name = opts.name ?? id
    const now = Date.now()
    db.prepare(
      `INSERT INTO agent_workspace (id, name, path, type, order_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, name, path, type, `order-${id}`, now, now)
  }

  const countWorkspaces = (): number =>
    (dbh.sqlite.prepare(`SELECT COUNT(*) AS c FROM agent_workspace`).get() as { c: number }).c

  const runMerge = (ctx: MergeContext): Promise<unknown> =>
    new MergeEngine(registry).mergeBackupIntoWork(dbh.sqlite, dbh.db, ctx)

  /** AGENTS-scope merge ctx with the host system-workspaces root for rebase. */
  const wsCtx = (overrides: Partial<MergeContext> = {}): MergeContext => ({
    backupDbPath: backupPath,
    domains: ['AGENTS'],
    skippedFileEntryIds: new Set<string>(),
    stagedFileEntryIds: new Set<string>(),
    hostSystemWorkspacesRoot,
    ...overrides
  })

  it('rebases a system workspace path to the host managed root (identity-joinable)', async () => {
    // Backup machine: system ws at /home/src/Data/Agents/system/2026-01-01/sess-a.
    // Host managed root: {hostSystemWorkspacesRoot}. The portable tail is
    // 2026-01-01/sess-a (everything after /system/) → host path joins under the host root.
    const backupAgentsRoot = '/home/src/Data/Agents'
    seedBackup((db) => {
      insertWorkspace(db, 'ws-sys', `${backupAgentsRoot}/system/2026-01-01/sess-a`, {
        type: 'system',
        name: 'sess-a'
      })
    })

    await runMerge(wsCtx())

    // INSERTed exactly once with the host-form path (portable tail preserved).
    expect(countWorkspaces()).toBe(1)
    const row = dbh.sqlite.prepare(`SELECT path, type FROM agent_workspace WHERE id = 'ws-sys'`).get() as {
      path: string
      type: string
    }
    expect(row.path).toBe(join(hostSystemWorkspacesRoot, '2026-01-01', 'sess-a'))
    expect(row.type).toBe('system')
  })

  it('FIELD_MERGEs a system workspace already present on the host (no duplicate)', async () => {
    // Host already has the same system ws (its own renderer wrote the host-form path).
    // Backup carries the same ws from another machine. identityKey must match AFTER
    // rebase → FIELD_MERGE keeps the local row, no duplicate.
    dbh.sqlite
      .prepare(
        `INSERT INTO agent_workspace (id, name, path, type, order_key, created_at, updated_at)
         VALUES ('ws-local', 'sess-a', ?, 'system', 'o1', ?, ?)`
      )
      .run(join(hostSystemWorkspacesRoot, '2026-01-01', 'sess-a'), Date.now(), Date.now())

    const backupAgentsRoot = '/home/src/Data/Agents'
    seedBackup((db) => {
      insertWorkspace(db, 'ws-backup', `${backupAgentsRoot}/system/2026-01-01/sess-a`, {
        type: 'system',
        name: 'sess-a'
      })
    })

    const result = (await runMerge(wsCtx())) as { degradedToSkips: unknown[] }

    // Exactly one row (no duplicate); local row retained.
    expect(countWorkspaces()).toBe(1)
    const row = dbh.sqlite
      .prepare(`SELECT id, path FROM agent_workspace WHERE path = ?`)
      .get(join(hostSystemWorkspacesRoot, '2026-01-01', 'sess-a')) as { id: string; path: string }
    expect(row.id).toBe('ws-local')
    // System ws rebase is faithful — no disclosure.
    expect(result.degradedToSkips).toHaveLength(0)
  })

  it('rebases a user workspace to a managed placeholder + discloses content missing', async () => {
    // Backup machine: user ws at an arbitrary absolute dir (/home/alice/Documents/my-ws).
    // The archive does not carry the dir contents (deferred) → host has no equivalent.
    // Rebase to {hostSystemWorkspacesRoot}/{basename} (placeholder) + disclose.
    seedBackup((db) => {
      insertWorkspace(db, 'ws-user', '/home/alice/Documents/my-ws', { type: 'user', name: 'my-ws' })
    })

    const result = (await runMerge(wsCtx())) as { degradedToSkips: { kind: string; reason?: string }[] }

    expect(countWorkspaces()).toBe(1)
    const row = dbh.sqlite.prepare(`SELECT path, type FROM agent_workspace WHERE id = 'ws-user'`).get() as {
      path: string
      type: string
    }
    expect(row.path).toBe(join(hostSystemWorkspacesRoot, 'my-ws'))
    expect(row.type).toBe('user')
    // User ws rebase is a placeholder — disclose the missing content.
    expect(result.degradedToSkips.length).toBeGreaterThanOrEqual(1)
    expect(
      result.degradedToSkips.some((d) => d.kind === 'resource_content_missing' && /workspace/i.test(d.reason ?? ''))
    ).toBe(true)
  })

  it('keeps a user workspace path unchanged when the same path already exists locally (same-machine)', async () => {
    // Same-machine restore: local already has user ws at /Users/me/proj. Backup carries
    // the same path. Rebase must NOT touch it — identity lookup matches the local row →
    // FIELD_MERGE keeps local (no duplicate, no placeholder, no disclosure).
    dbh.sqlite
      .prepare(
        `INSERT INTO agent_workspace (id, name, path, type, order_key, created_at, updated_at)
         VALUES ('ws-local', 'proj', ?, 'user', 'o1', ?, ?)`
      )
      .run('/Users/me/proj', Date.now(), Date.now())

    seedBackup((db) => {
      insertWorkspace(db, 'ws-backup', '/Users/me/proj', { type: 'user', name: 'proj' })
    })

    const result = (await runMerge(wsCtx())) as { degradedToSkips: unknown[] }

    // Exactly one row (FIELD_MERGE), path unchanged, no disclosure.
    expect(countWorkspaces()).toBe(1)
    const row = dbh.sqlite.prepare(`SELECT id, path FROM agent_workspace WHERE path = '/Users/me/proj'`).get() as {
      id: string
      path: string
    }
    expect(row.id).toBe('ws-local')
    expect(result.degradedToSkips).toHaveLength(0)
  })

  it('leaves a non-rebasable path untouched (defensive, no disclosure)', async () => {
    // A relative/empty path cannot be rebased — keep the original value, do not disclose.
    // (normalizeWorkspacePath rejects non-absolute in production, so this is defensive only.)
    seedBackup((db) => {
      insertWorkspace(db, 'ws-rel', 'relative/x', { type: 'user' })
    })

    const result = (await runMerge(wsCtx())) as { degradedToSkips: unknown[] }

    expect(countWorkspaces()).toBe(1)
    const row = dbh.sqlite.prepare(`SELECT path FROM agent_workspace WHERE id = 'ws-rel'`).get() as { path: string }
    expect(row.path).toBe('relative/x') // unchanged
    expect(result.degradedToSkips).toHaveLength(0)
  })

  it('normalizes backslash separators when rebasing a Windows system workspace', async () => {
    // Backup machine is Windows: system ws path uses backslashes. The /system/ tail must
    // still be extracted after normalization and joined under the (POSIX) host root.
    seedBackup((db) => {
      insertWorkspace(db, 'ws-win', 'C:\\Users\\src\\Data\\Agents\\system\\2026-03-09\\sess-b', {
        type: 'system',
        name: 'sess-b'
      })
    })

    await runMerge(wsCtx())

    expect(countWorkspaces()).toBe(1)
    const row = dbh.sqlite.prepare(`SELECT path FROM agent_workspace WHERE id = 'ws-win'`).get() as { path: string }
    expect(row.path).toBe(join(hostSystemWorkspacesRoot, '2026-03-09', 'sess-b'))
  })
})
