import fs from 'node:fs'
import path from 'node:path'

import { sanitizeFilename } from '@main/utils/legacyFile'
import Database from 'better-sqlite3'

const LEGACY_VECTOR_TABLE_NAME = 'vectors'

/** One legacy vector row, streamed or point-read — never a whole base at once. */
export interface LegacyKnowledgeVectorRow {
  rowid: number
  pageContent: string
  uniqueLoaderId: string
  vector: LegacyKnowledgeVectorDecodeResult
}

/**
 * A projection of just the two columns a `uniqueLoaderId → source` map needs. Used by callers
 * (directory expansion in KnowledgeMigrator) that must not pay to read + float32-decode the
 * vector BLOBs.
 */
export interface LegacyKnowledgeLoaderSourceRow {
  uniqueLoaderId: string
  source: string
}

export type LegacyKnowledgeVectorDecodeResult =
  | { status: 'decoded'; value: Float32Array }
  | { status: 'missing' }
  | { status: 'unsupported_encoding'; encoding: string }

/** Shared non-`ok` outcomes for both the streaming open and the loader-source-only read. */
type LegacyKnowledgeSourceLoadFailure = {
  status: 'invalid_path' | 'missing' | 'directory' | 'not_embedjs'
  dbPath?: string
}

export type LegacyKnowledgeVectorOpenResult =
  | { status: 'ok'; dbPath: string; reader: LegacyKnowledgeVectorBaseReader }
  | LegacyKnowledgeSourceLoadFailure

export type LegacyKnowledgeLoaderSourceVisitResult =
  | { status: 'ok'; dbPath: string; rowCount: number }
  | LegacyKnowledgeSourceLoadFailure

// The legacy embedjs `vector` BLOB is not decoded to one stable JS type across
// runtimes. better-sqlite3 returns a Buffer (an ArrayBufferView), but other
// shapes (Float32Array, ArrayBuffer, plain array) may appear, so keep the
// decoder intentionally permissive.
function describeLegacyVectorEncoding(raw: unknown): string {
  if (raw === null) {
    return 'null'
  }

  if (raw === undefined) {
    return 'undefined'
  }

  if (typeof raw !== 'object') {
    return typeof raw
  }

  return raw.constructor?.name ?? 'Object'
}

/**
 * Decode a legacy vector payload into a fresh `Float32Array` — always a copy, never a view over
 * the driver's row Buffer: a zero-copy view would pin the whole row allocation for as long as the
 * vector lives and require a 4-byte alignment better-sqlite3 does not guarantee. `Float32Array`
 * (not `number[]`) halves the resident size of every decoded vector, which matters because the
 * caller streams hundreds of thousands of these during a large migration.
 */
function deserializeLegacyVector(raw: unknown): LegacyKnowledgeVectorDecodeResult {
  if (raw === null || raw === undefined) {
    return { status: 'missing' }
  }

  if (raw instanceof Float32Array) {
    return { status: 'decoded', value: new Float32Array(raw) }
  }

  if (raw instanceof ArrayBuffer) {
    return { status: 'decoded', value: new Float32Array(raw.slice(0)) }
  }

  if (ArrayBuffer.isView(raw)) {
    const bytes = new Uint8Array(raw.byteLength)
    bytes.set(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength))
    return { status: 'decoded', value: new Float32Array(bytes.buffer) }
  }

  if (Array.isArray(raw)) {
    return { status: 'decoded', value: Float32Array.from(raw, (value) => Number(value)) }
  }

  return { status: 'unsupported_encoding', encoding: describeLegacyVectorEncoding(raw) }
}

function toLegacyVectorRow(raw: Record<string, unknown>): LegacyKnowledgeVectorRow {
  return {
    rowid: Number(raw.rowid),
    pageContent: String(raw.pageContent ?? ''),
    uniqueLoaderId: String(raw.uniqueLoaderId ?? ''),
    vector: deserializeLegacyVector(raw.vector)
  }
}

/**
 * A handle over one base's open legacy vector DB, exposing a bounded streaming scan
 * instead of a whole-base materialization (which OOM'd large bases:
 * every row's Buffer, decoded vector and page text resident at once). The caller owns the handle
 * and must `close()` it (try/finally) when done.
 */
export class LegacyKnowledgeVectorBaseReader {
  constructor(private readonly db: Database.Database) {}

  /**
   * Stream every row in rowid order (the legacy read order), one decoded row at a time — each
   * row's Buffer and vector fall out of scope as soon as the consumer moves on. Early exit
   * (break/throw) releases the underlying statement.
   */
  *iterateRows(): IterableIterator<LegacyKnowledgeVectorRow> {
    const statement = this.db.prepare(
      `SELECT rowid, pageContent, uniqueLoaderId, vector FROM ${LEGACY_VECTOR_TABLE_NAME} ORDER BY rowid`
    )
    for (const raw of statement.iterate() as IterableIterator<Record<string, unknown>>) {
      yield toLegacyVectorRow(raw)
    }
  }

  close(): void {
    this.db.close()
  }
}

export class KnowledgeVectorSourceReader {
  constructor(private readonly knowledgeBaseDir: string) {}

  getLegacyDbPath(baseId: string): string | null {
    return path.join(this.knowledgeBaseDir, sanitizeFilename(baseId, '_'))
  }

  /**
   * Open a base's legacy vector DB for bounded-memory streaming access. On `ok` the caller owns
   * the returned reader and must `close()` it. Use this
   * when the vectors themselves are needed (the vector migrator); to build a loader→source map,
   * use the lighter {@link visitBaseLoaderSources}.
   */
  openBase(baseId: string): LegacyKnowledgeVectorOpenResult {
    const opened = this.openLegacyDb(baseId)
    if (opened.status !== 'ok') {
      return opened
    }
    return { status: 'ok', dbPath: opened.dbPath, reader: new LegacyKnowledgeVectorBaseReader(opened.db) }
  }

  /**
   * Read only the *distinct* `uniqueLoaderId`/`source` pairs — never the pageContent or vector
   * BLOB. This lets directory expansion build its loader→source map without synchronously reading
   * and float32-decoding a whole base's vectors, which on large folders froze the migration UI and
   * risked OOM; the `DISTINCT` also keeps the returned rows down to one per loader instead of one
   * per chunk. Path resolution and the embedjs guard are shared with {@link openBase}, so both
   * reads see the exact same set of loaders.
   */
  async visitBaseLoaderSources(
    baseId: string,
    onRow: (row: LegacyKnowledgeLoaderSourceRow) => void
  ): Promise<LegacyKnowledgeLoaderSourceVisitResult> {
    const opened = this.openLegacyDb(baseId)
    if (opened.status !== 'ok') {
      return opened
    }
    try {
      let rowCount = 0
      const statement = opened.db.prepare(`SELECT DISTINCT uniqueLoaderId, source FROM ${LEGACY_VECTOR_TABLE_NAME}`)
      for (const raw of statement.iterate() as IterableIterator<Record<string, unknown>>) {
        onRow({
          uniqueLoaderId: String(raw.uniqueLoaderId ?? ''),
          source: String(raw.source ?? '')
        })
        rowCount += 1
      }
      return { status: 'ok', dbPath: opened.dbPath, rowCount }
    } finally {
      opened.db.close()
    }
  }

  private openLegacyDb(
    baseId: string
  ): { status: 'ok'; dbPath: string; db: Database.Database } | LegacyKnowledgeSourceLoadFailure {
    const dbPath = this.getLegacyDbPath(baseId)
    if (!dbPath) {
      return { status: 'invalid_path' }
    }

    if (!fs.existsSync(dbPath)) {
      return { status: 'missing', dbPath }
    }

    if (fs.statSync(dbPath).isDirectory()) {
      return { status: 'directory', dbPath }
    }

    // Probing a corrupt/locked file makes isEmbedjsDatabase throw; the connection is only owned
    // by the caller once the probe passes, so close it ourselves on every other exit.
    const db = new Database(dbPath, { readonly: true, fileMustExist: true })
    let transferred = false
    try {
      if (!this.isEmbedjsDatabase(db)) {
        return { status: 'not_embedjs', dbPath }
      }
      transferred = true
      return { status: 'ok', dbPath, db }
    } finally {
      if (!transferred) {
        db.close()
      }
    }
  }

  private isEmbedjsDatabase(db: Database.Database): boolean {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(LEGACY_VECTOR_TABLE_NAME)

    return row !== undefined
  }
}
