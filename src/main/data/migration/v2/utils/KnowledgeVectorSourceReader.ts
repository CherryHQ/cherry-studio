import fs from 'node:fs'
import path from 'node:path'

import Database from 'better-sqlite3'

import { sanitizeFilename } from '@main/utils/legacyFile'

const LEGACY_VECTOR_TABLE_NAME = 'vectors'
// `rowid IN (...)` binds one SQL variable per id; stay well under SQLite's bound-variable cap,
// matching the repo convention (FileRefService / ChatMigrator chunk at 500).
const ROWID_BATCH_SIZE = 500

/** One legacy vector row, streamed or point-read — never a whole base at once. */
export interface LegacyKnowledgeVectorRow {
  rowid: number
  pageContent: string
  uniqueLoaderId: string
  vector: LegacyKnowledgeVectorDecodeResult
}

/** A projection of just the text columns — no vector BLOB read or decoded. */
export interface LegacyKnowledgeVectorTextRow {
  rowid: number
  pageContent: string
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

export type LegacyKnowledgeLoaderSourceLoadResult =
  | { status: 'ok'; dbPath: string; rows: LegacyKnowledgeLoaderSourceRow[] }
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
 * A handle over one base's open legacy vector DB, exposing the two bounded-memory access shapes
 * the vector migrator needs instead of a whole-base materialization (which OOM'd large bases:
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

  /**
   * Point-read a specific row set (one item's chunks), returned in rowid order regardless of the
   * input order. rowid is the table's primary key, so each batch is an index lookup, not a scan.
   */
  loadRowsByRowids(rowids: number[]): LegacyKnowledgeVectorRow[] {
    const rows: LegacyKnowledgeVectorRow[] = []
    for (let offset = 0; offset < rowids.length; offset += ROWID_BATCH_SIZE) {
      const batch = rowids.slice(offset, offset + ROWID_BATCH_SIZE)
      const placeholders = batch.map(() => '?').join(', ')
      const statement = this.db.prepare(
        `SELECT rowid, pageContent, uniqueLoaderId, vector FROM ${LEGACY_VECTOR_TABLE_NAME} WHERE rowid IN (${placeholders})`
      )
      for (const raw of statement.all(...batch) as Array<Record<string, unknown>>) {
        rows.push(toLegacyVectorRow(raw))
      }
    }
    rows.sort((a, b) => a.rowid - b.rowid)
    return rows
  }

  /**
   * Point-read only the text columns of a row set, in rowid order. The column projection means
   * the vector BLOBs are never read off disk or decoded — this is what lets the migrator
   * assemble an item's full content text (needed whole: the content schema stores one text row
   * per material) without also holding the item's full vector set, which it instead streams in
   * batches via {@link loadRowsByRowids}.
   */
  loadTextRowsByRowids(rowids: number[]): LegacyKnowledgeVectorTextRow[] {
    const rows: LegacyKnowledgeVectorTextRow[] = []
    for (let offset = 0; offset < rowids.length; offset += ROWID_BATCH_SIZE) {
      const batch = rowids.slice(offset, offset + ROWID_BATCH_SIZE)
      const placeholders = batch.map(() => '?').join(', ')
      const statement = this.db.prepare(
        `SELECT rowid, pageContent FROM ${LEGACY_VECTOR_TABLE_NAME} WHERE rowid IN (${placeholders})`
      )
      for (const raw of statement.all(...batch) as Array<Record<string, unknown>>) {
        rows.push({ rowid: Number(raw.rowid), pageContent: String(raw.pageContent ?? '') })
      }
    }
    rows.sort((a, b) => a.rowid - b.rowid)
    return rows
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
   * Open a base's legacy vector DB for bounded-memory access (streaming scan or per-item
   * point-reads). On `ok` the caller owns the returned reader and must `close()` it. Use this
   * when the vectors themselves are needed (the vector migrator); to build a loader→source map,
   * use the lighter {@link loadBaseLoaderSources}.
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
  async loadBaseLoaderSources(baseId: string): Promise<LegacyKnowledgeLoaderSourceLoadResult> {
    const opened = this.openLegacyDb(baseId)
    if (opened.status !== 'ok') {
      return opened
    }
    try {
      return { status: 'ok', dbPath: opened.dbPath, rows: this.readLegacyLoaderSourceRows(opened.db) }
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

  private readLegacyLoaderSourceRows(db: Database.Database): LegacyKnowledgeLoaderSourceRow[] {
    // `DISTINCT` dedups in SQLite so this materializes only the unique loader/source pairs the
    // caller folds into its map — not one JS object per legacy vector chunk. A large folder can
    // have thousands of chunks under a single loader; without `DISTINCT` that's thousands of
    // redundant allocations here for a map that keeps one entry per loader.
    const statement = db.prepare(`SELECT DISTINCT uniqueLoaderId, source FROM ${LEGACY_VECTOR_TABLE_NAME}`)
    const rows = statement.all() as Array<Record<string, unknown>>

    return rows.map((row) => ({
      uniqueLoaderId: String(row.uniqueLoaderId ?? ''),
      source: String(row.source ?? '')
    }))
  }
}
