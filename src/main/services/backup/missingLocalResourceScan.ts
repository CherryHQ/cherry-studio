// D8 统计告知版 — MCP server package-dir missing scan (disposition matrix D8/B10, node 2.1).
//
// MCP_SERVERS is a schema-only backup contributor (no `operations` / no staging): a restore
// re-creates the `mcp_server` row but NOT the DXT/MCPB package directory its `dxtPath` points
// at, so on a new machine the server cannot start. This scan detects that gap and reports it
// as a NON-BLOCKING statistic.
//
// Boundary (partial slice):
//  - Does NOT change the resource/staging system, does NOT block merge.
//  - Does NOT add to `RestoreDegradation` / journal summary / result-page UI. User-visible
//    disclosure (a new degradation kind or summary field) is a contract decision that waits
//    for the full staging provider — owner TBD: @DeJeune file-resource hooks.
//  - Forbidden as a rejection condition: existence/contentHash must NOT gate admission or
//    merge (B11 is the fail-closed track; this is the intentionally-uncollected-local-path
//    track). This slice only makes the gap observable via loggerService today.
//
// The scan reads the post-merge work DB (the true final state after SKIP/INSERT/FIELD_MERGE),
// so SKIP'd rows keep their LOCAL dxtPath (usually present) and imported rows carry the SOURCE
// machine's path (usually absent on the target machine). Either way the report reflects which
// servers will fail to start after promotion — the accurate, non-blocking signal we want.

import fs from 'node:fs'

import { loggerService } from '@logger'
import type Database from 'better-sqlite3'

// Central logger — this scan is diagnostic-only and must never throw into the restore path.
const logger = loggerService.withContext('backup/missingLocalResourceScan')

/** One MCP server whose `dxtPath` does not resolve on the local filesystem. */
export interface MissingMcpPackage {
  readonly name: string
  readonly dxtPath: string
}

/** Aggregate stat consumed by the caller for a logger.warn summary line. */
export interface MissingMcpPackageStat {
  /** Number of MCP servers referencing a missing local package dir. */
  readonly count: number
  /** Per-server detail (name + the missing path) — bounded by mcp_server row count. */
  readonly servers: readonly MissingMcpPackage[]
}

/**
 * Scan the (post-merge) work DB for `mcp_server` rows whose `dxtPath` references a package
 * directory that does NOT exist on the local filesystem. Read-only and non-throwing: a stats
 * query or an unreadable path yields an empty report, never a failed restore.
 *
 * Only non-null, non-empty `dxtPath` values are checked — a server without a package dir
 * (stdio/sse/streamableHttp launched from `command`/`baseUrl`) is not a DXT package and is
 * irrelevant to this scan.
 */
export function scanMissingMcpPackageDirs(workSqlite: Database.Database): MissingMcpPackageStat {
  // Raw SQL keeps this scan dependency-light and decoupled from the merge engine / drizzle
  // session (consistent with MergeEngine's focused `db.prepare(...)` reads). `dxt_path` is the
  // snake_case column name (drizzle casing: 'snake_case'); `name` is NOT NULL.
  //
  // The query itself is best-effort: a missing `mcp_server` table (cross-version / corrupt /
  // test stub), a locked DB, or any prepare/all error must NEVER fail the restore — this scan
  // is diagnostic-only (D8 partial slice, non-throwing contract). Swallow and return empty.
  let rows: ReadonlyArray<{ name: string; dxtPath: string }>
  try {
    rows = workSqlite
      .prepare('SELECT name, dxt_path AS dxtPath FROM mcp_server WHERE dxt_path IS NOT NULL AND dxt_path <> ?')
      .all('') as ReadonlyArray<{ name: string; dxtPath: string }>
  } catch (error) {
    logger.warn('mcp_server scan query failed; skipping missing-package report', error as Error)
    return { count: 0, servers: [] }
  }

  const missing: MissingMcpPackage[] = []
  for (const row of rows) {
    // dxtPath points at an extracted DXT package DIRECTORY (McpPackageService joins
    // manifest.json inside it). statSync().isDirectory() rejects a stray regular file at that
    // path so it isn't misreported as present. statSync is synchronous (better-sqlite3 is a sync
    // driver); a thrown check (ENOENT / permission) is swallowed so a single unreadable path
    // can never fail the restore.
    let isPackageDir = false
    try {
      isPackageDir = fs.statSync(row.dxtPath).isDirectory()
    } catch {
      isPackageDir = false
    }
    if (!isPackageDir) {
      missing.push({ name: row.name, dxtPath: row.dxtPath })
    }
  }
  return { count: missing.length, servers: missing }
}
