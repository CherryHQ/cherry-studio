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

export type LegacyKnowledgeVectorDecodeResult =
  | { status: 'decoded'; value: number[] }
  | { status: 'missing' }
  | { status: 'unsupported_encoding'; encoding: string }

export type LegacyKnowledgeVectorLoadResult =
  | { status: 'ok'; dbPath: string; rows: LegacyKnowledgeVectorRow[] }
  | { status: 'invalid_path' | 'missing' | 'directory' | 'not_embedjs'; dbPath?: string }

export class KnowledgeVectorSourceReader {
  constructor(private readonly knowledgeBaseDir: string) {}

  getLegacyDbPath(baseId: string): string | null {
    return path.join(this.knowledgeBaseDir, sanitizeFilename(baseId, '_'))
  }

  async loadBase(baseId: string): Promise<LegacyKnowledgeVectorLoadResult> {
    const dbPath = this.getLegacyDbPath(baseId)
    if (!dbPath) {
      return { status: 'invalid_path' }
    }

    if (!fs.existsSync(dbPath)) {
      return { status: 'missing', dbPath }
    }

    const stat = fs.statSync(dbPath)
    if (stat.isDirectory()) {
      return { status: 'directory', dbPath }
    }

    return this.loadLegacyDb(dbPath)
  }

  private loadLegacyDb(dbPath: string): LegacyKnowledgeVectorLoadResult {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true })
    try {
      const isEmbedjs = this.isEmbedjsDatabase(db)
      if (!isEmbedjs) {
        return { status: 'not_embedjs', dbPath }
      }

      return {
        status: 'ok',
        dbPath,
        rows: this.readLegacyVectorRows(db)
      }
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
