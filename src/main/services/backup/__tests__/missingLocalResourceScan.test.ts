// Unit tests for scanMissingMcpPackageDirs — D8 统计告知版 (disposition matrix D8/B10).
//
// The scan reads the post-merge work DB for mcp_server rows whose `dxtPath` package dir is
// absent on the local filesystem and reports a NON-BLOCKING stat. These tests cover the pure
// scanner: existing/missing/null/empty dxtPath handling, and that it never throws.
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'

import { scanMissingMcpPackageDirs } from '../missingLocalResourceScan'

/** Minimal mcp_server shape — only `name` (NOT NULL) + `dxt_path` matter to the scan. */
function makeDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE mcp_server (id TEXT PRIMARY KEY, name TEXT NOT NULL, dxt_path TEXT)`)
  return db
}

describe('scanMissingMcpPackageDirs', () => {
  let existingDir: string

  beforeEach(() => {
    // A path that genuinely exists on this machine, so the scanner treats it as present.
    existingDir = mkdtempSync(join(tmpdir(), 'cs-mcp-present-'))
  })

  it('reports only rows whose dxtPath does not exist on the local filesystem', () => {
    const db = makeDb()
    db.prepare('INSERT INTO mcp_server (id, name, dxt_path) VALUES (?, ?, ?)').run(
      'srv-missing',
      'missing-server',
      join(tmpdir(), 'cs-definitely-absent-' + Date.now())
    )
    db.prepare('INSERT INTO mcp_server (id, name, dxt_path) VALUES (?, ?, ?)').run(
      'srv-present',
      'present-server',
      existingDir
    )

    const stat = scanMissingMcpPackageDirs(db)

    expect(stat.count).toBe(1)
    expect(stat.servers).toEqual([
      { name: 'missing-server', dxtPath: expect.stringContaining('cs-definitely-absent-') }
    ])
    db.close()
  })

  it('skips rows with NULL or empty dxtPath (non-DXT servers: stdio/sse/streamableHttp)', () => {
    const db = makeDb()
    db.prepare('INSERT INTO mcp_server (id, name, dxt_path) VALUES (?, ?, ?)').run('srv-null', 'null-server', null)
    db.prepare('INSERT INTO mcp_server (id, name, dxt_path) VALUES (?, ?, ?)').run('srv-empty', 'empty-server', '')

    const stat = scanMissingMcpPackageDirs(db)

    expect(stat.count).toBe(0)
    expect(stat.servers).toEqual([])
    db.close()
  })

  it('aggregates multiple missing servers into one stat (count + scopes)', () => {
    const db = makeDb()
    const insert = db.prepare('INSERT INTO mcp_server (id, name, dxt_path) VALUES (?, ?, ?)')
    insert.run('m1', 'alpha', join(tmpdir(), 'cs-absent-a-' + Date.now()))
    insert.run('m2', 'beta', join(tmpdir(), 'cs-absent-b-' + Date.now()))
    insert.run('m3', 'gamma', existingDir)

    const stat = scanMissingMcpPackageDirs(db)

    expect(stat.count).toBe(2)
    expect(stat.servers.map((s) => s.name).sort()).toEqual(['alpha', 'beta'])
    db.close()
  })

  it('returns an empty stat when the table has no rows', () => {
    const db = makeDb()
    const stat = scanMissingMcpPackageDirs(db)
    expect(stat.count).toBe(0)
    expect(stat.servers).toEqual([])
    db.close()
  })

  it('never throws — an unreadable path is treated as missing, not fatal', () => {
    const db = makeDb()
    // A NUL-terminated string is invalid as a filesystem path; statSync must not crash the scan.
    db.prepare('INSERT INTO mcp_server (id, name, dxt_path) VALUES (?, ?, ?)').run('srv-bad', 'bad-path-server', 'a\0b')

    const stat = scanMissingMcpPackageDirs(db)
    expect(stat.count).toBe(1)
    db.close()
  })

  it('returns an empty stat (never throws) when the mcp_server table is absent', () => {
    // A cross-version / corrupt / stub work DB may not have mcp_server at all. The scan is
    // diagnostic-only and non-throwing — prepare().all() must be swallowed, not propagated to
    // fail the restore (D8 non-blocking contract).
    const db = new Database(':memory:')
    // No mcp_server table created — prepare() would throw "no such table".
    const stat = scanMissingMcpPackageDirs(db)
    expect(stat.count).toBe(0)
    expect(stat.servers).toEqual([])
    db.close()
  })

  it('treats a regular file at dxtPath as missing (dxtPath must be a package DIRECTORY)', () => {
    // dxtPath points at an extracted DXT package directory (McpPackageService joins manifest.json
    // inside it). A stray regular file at that path is NOT a valid package and must be reported
    // missing — not misreported as present by a bare existence check.
    const db = makeDb()
    const filePath = join(existingDir, 'not-a-dir-file')
    writeFileSync(filePath, 'x')
    db.prepare('INSERT INTO mcp_server (id, name, dxt_path) VALUES (?, ?, ?)').run('srv-file', 'file-server', filePath)

    const stat = scanMissingMcpPackageDirs(db)
    expect(stat.count).toBe(1)
    expect(stat.servers).toEqual([{ name: 'file-server', dxtPath: filePath }])
    db.close()
  })
})
