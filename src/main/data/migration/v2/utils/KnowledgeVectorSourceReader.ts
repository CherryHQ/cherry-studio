import fs from 'node:fs'
import path from 'node:path'

import { sanitizeFilename } from '@main/utils/legacyFile'
import Database from 'better-sqlite3'

const LEGACY_VECTOR_TABLE_NAME = 'vectors'

export interface LegacyKnowledgeVectorRow {
  pageContent: string
  uniqueLoaderId: string
  source: string
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
  | { status: 'decoded'; value: number[] }
  | { status: 'missing' }
  | { status: 'unsupported_encoding'; encoding: string }

/** Shared non-`ok` outcomes for both the full read and the loader-source-only read. */
type LegacyKnowledgeSourceLoadFailure = {
  status: 'invalid_path' | 'missing' | 'directory' | 'not_embedjs'
  dbPath?: string
}

export type LegacyKnowledgeVectorLoadResult =
  | { status: 'ok'; dbPath: string; rows: LegacyKnowledgeVectorRow[] }
  | LegacyKnowledgeSourceLoadFailure

export type LegacyKnowledgeLoaderSourceLoadResult =
  | { status: 'ok'; dbPath: string; rows: LegacyKnowledgeLoaderSourceRow[] }
  | LegacyKnowledgeSourceLoadFailure

export class KnowledgeVectorSourceReader {
  constructor(private readonly knowledgeBaseDir: string) {}

  getLegacyDbPath(baseId: string): string | null {
    return path.join(this.knowledgeBaseDir, sanitizeFilename(baseId, '_'))
  }

  /**
   * Read a base's full legacy vector rows (page content + decoded vectors). Use this only when
   * the vectors themselves are needed (the vector migrator); to build a loader→source map, use
   * the lighter {@link loadBaseLoaderSources}.
   */
  async loadBase(baseId: string): Promise<LegacyKnowledgeVectorLoadResult> {
    return this.loadFromLegacyDb(baseId, (db) => this.readLegacyVectorRows(db))
  }

  /**
   * Read only the *distinct* `uniqueLoaderId`/`source` pairs — never the pageContent or vector
   * BLOB. This lets directory expansion build its loader→source map without synchronously reading
   * and float32-decoding a whole base's vectors, which on large folders froze the migration UI and
   * risked OOM; the `DISTINCT` also keeps the returned rows down to one per loader instead of one
   * per chunk. Path resolution and the embedjs guard are shared with {@link loadBase}, so both
   * reads see the exact same set of loaders.
   */
  async loadBaseLoaderSources(baseId: string): Promise<LegacyKnowledgeLoaderSourceLoadResult> {
    return this.loadFromLegacyDb(baseId, (db) => this.readLegacyLoaderSourceRows(db))
  }

  private loadFromLegacyDb<TRow>(
    baseId: string,
    readRows: (db: Database.Database) => TRow[]
  ): { status: 'ok'; dbPath: string; rows: TRow[] } | LegacyKnowledgeSourceLoadFailure {
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

    const db = new Database(dbPath, { readonly: true, fileMustExist: true })
    try {
      if (!this.isEmbedjsDatabase(db)) {
        return { status: 'not_embedjs', dbPath }
      }

      return { status: 'ok', dbPath, rows: readRows(db) }
    } finally {
      db.close()
    }
  }

  private isEmbedjsDatabase(db: Database.Database): boolean {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(LEGACY_VECTOR_TABLE_NAME)

    return row !== undefined
  }

  private readLegacyVectorRows(db: Database.Database): LegacyKnowledgeVectorRow[] {
    const rows = db
      .prepare(`SELECT pageContent, uniqueLoaderId, source, vector FROM ${LEGACY_VECTOR_TABLE_NAME}`)
      .all() as Array<Record<string, unknown>>

    return rows.map((row) => ({
      pageContent: String(row.pageContent ?? ''),
      uniqueLoaderId: String(row.uniqueLoaderId ?? ''),
      source: String(row.source ?? ''),
      vector: this.deserializeLegacyVector(row.vector)
    }))
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

  // The legacy embedjs `vector` BLOB is not decoded to one stable JS type across
  // runtimes. better-sqlite3 returns a Buffer (an ArrayBufferView), but other
  // shapes (Float32Array, ArrayBuffer, plain array) may appear, so keep the
  // decoder intentionally permissive.
  private describeLegacyVectorEncoding(raw: unknown): string {
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

  private deserializeLegacyVector(raw: unknown): LegacyKnowledgeVectorDecodeResult {
    if (raw === null || raw === undefined) {
      return { status: 'missing' }
    }

    if (raw instanceof Float32Array) {
      return { status: 'decoded', value: Array.from(raw) }
    }

    if (raw instanceof ArrayBuffer) {
      return { status: 'decoded', value: Array.from(new Float32Array(raw)) }
    }

    if (ArrayBuffer.isView(raw)) {
      const view = raw
      return {
        status: 'decoded',
        value: Array.from(
          new Float32Array(view.buffer, view.byteOffset, view.byteLength / Float32Array.BYTES_PER_ELEMENT)
        )
      }
    }

    if (Array.isArray(raw)) {
      return { status: 'decoded', value: raw.map((value) => Number(value)) }
    }

    return { status: 'unsupported_encoding', encoding: this.describeLegacyVectorEncoding(raw) }
  }
}
