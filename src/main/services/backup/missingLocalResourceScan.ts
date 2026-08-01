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

import type Database from 'better-sqlite3'

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
  const rows = workSqlite
    .prepare('SELECT name, dxt_path AS dxtPath FROM mcp_server WHERE dxt_path IS NOT NULL AND dxt_path <> ?')
    .all('') as ReadonlyArray<{ name: string; dxtPath: string }>

  const missing: MissingMcpPackage[] = []
  for (const row of rows) {
    // existsSync is synchronous (better-sqlite3 is a sync driver); a thrown check (e.g. permission)
    // is swallowed so a single unreadable path can never fail the restore.
    let exists = false
    try {
      exists = fs.existsSync(row.dxtPath)
    } catch {
      exists = false
    }
    if (!exists) {
      missing.push({ name: row.name, dxtPath: row.dxtPath })
    }
  }
  return { count: missing.length, servers: missing }
}
