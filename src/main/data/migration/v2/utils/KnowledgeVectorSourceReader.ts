import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { type Client, createClient, type Value as LibsqlValue } from '@libsql/client'
import { sanitizeFilename } from '@main/utils/file'

const LEGACY_VECTOR_TABLE_NAME = 'vectors'
const LEGACY_VECTOR_BACKUP_SUFFIX = '.embedjs.bak'

export interface LegacyKnowledgeVectorRow {
  pageContent: string
  uniqueLoaderId: string
  source: string
  vector: number[] | null
}

export type LegacyKnowledgeVectorLoadResult =
  | { status: 'ok'; dbPath: string; rows: LegacyKnowledgeVectorRow[] }
  | { status: 'invalid_path' | 'missing' | 'directory' | 'not_embedjs'; dbPath?: string }

export class KnowledgeVectorSourceReader {
  constructor(private readonly knowledgeBaseDir: string) {}

  getLegacyDbPath(baseId: string): string | null {
    return path.join(this.knowledgeBaseDir, sanitizeFilename(baseId, '_'))
  }

  private getLegacyBackupPath(dbPath: string): string {
    return `${dbPath}${LEGACY_VECTOR_BACKUP_SUFFIX}`
  }

  async loadBase(baseId: string): Promise<LegacyKnowledgeVectorLoadResult> {
    const dbPath = this.getLegacyDbPath(baseId)
    if (!dbPath) {
      return { status: 'invalid_path' }
    }

    const backupPath = this.getLegacyBackupPath(dbPath)
    if (!fs.existsSync(dbPath)) {
      if (fs.existsSync(backupPath)) {
        return this.loadLegacyDb(dbPath, backupPath)
      }
      return { status: 'missing', dbPath }
    }

    const stat = fs.statSync(dbPath)
    if (stat.isDirectory()) {
      return { status: 'directory', dbPath }
    }

    const result = await this.loadLegacyDb(dbPath, dbPath)
    if (result.status === 'not_embedjs' && fs.existsSync(backupPath)) {
      return this.loadLegacyDb(dbPath, backupPath)
    }

    return result
  }

  private async loadLegacyDb(dbPath: string, sourcePath: string): Promise<LegacyKnowledgeVectorLoadResult> {
    const client = createClient({ url: pathToFileURL(sourcePath).toString() })
    try {
      const isEmbedjs = await this.isEmbedjsDatabase(client)
      if (!isEmbedjs) {
        return { status: 'not_embedjs', dbPath }
      }

      return {
        status: 'ok',
        dbPath,
        rows: await this.readLegacyVectorRows(client)
      }
    } finally {
      client.close()
    }
  }

  private async isEmbedjsDatabase(client: Client): Promise<boolean> {
    const result = await client.execute({
      sql: "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
      args: [LEGACY_VECTOR_TABLE_NAME]
    })

    return result.rows.length > 0
  }

  private async readLegacyVectorRows(client: Client): Promise<LegacyKnowledgeVectorRow[]> {
    const result = await client.execute({
      sql: `SELECT pageContent, uniqueLoaderId, source, vector FROM ${LEGACY_VECTOR_TABLE_NAME}`,
      args: []
    })

    return result.rows.map((row) => ({
      pageContent: String(row.pageContent ?? ''),
      uniqueLoaderId: String(row.uniqueLoaderId ?? ''),
      source: String(row.source ?? ''),
      vector: this.deserializeLegacyVector(row.vector)
    }))
  }

  // libsql F32_BLOB values are not decoded to one stable JS type across
  // client/runtime combinations. In local verification on macOS this returns
  // ArrayBuffer, but other environments may expose Float32Array or another
  // ArrayBufferView, so keep the decoder intentionally permissive.
  private deserializeLegacyVector(raw: LibsqlValue): number[] | null {
    if (raw === null || raw === undefined) {
      return null
    }

    if (raw instanceof Float32Array) {
      return Array.from(raw)
    }

    if (raw instanceof ArrayBuffer) {
      return Array.from(new Float32Array(raw))
    }

    if (ArrayBuffer.isView(raw)) {
      const view = raw as ArrayBufferView
      return Array.from(
        new Float32Array(view.buffer, view.byteOffset, view.byteLength / Float32Array.BYTES_PER_ELEMENT)
      )
    }

    if (Array.isArray(raw)) {
      return raw.map((value) => Number(value))
    }

    return null
  }
}
