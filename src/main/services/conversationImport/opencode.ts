import { createHash } from 'node:crypto'
import { lstat, readdir } from 'node:fs/promises'
import path from 'node:path'

import Database from 'better-sqlite3'
import * as z from 'zod'

import type { MessageData } from '@shared/data/types/message'

import { IMPORT_LIMITS, type HistorySourceAdapter, type NormalizedSession } from './types'

type Layout = { session: 'session' | 'session_v2'; message: 'message' | 'session_message'; parts: boolean }
const Session = z
  .object({ id: z.string().min(1), title: z.string().nullable(), directory: z.string(), version: z.string() })
  .passthrough()
const Message = z.object({
  id: z.string(),
  data: z.string(),
  time_created: z.number().int(),
  seq: z.number().int().optional(),
  type: z.string().optional()
})
const ObjectData = z.record(z.string(), z.unknown())

function layouts(db: Database.Database): Layout[] {
  const tables = new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name)
  )
  const has = (table: string, required: string[]) => {
    if (!tables.has(table)) throw new Error('unsupported_database_layout')
    const columns = new Set(
      (db.prepare('PRAGMA table_info(' + table + ')').all() as { name: string }[]).map((c) => c.name)
    )
    if (required.some((name) => !columns.has(name))) throw new Error('unsupported_database_layout')
  }
  const result: Layout[] = []
  if (tables.has('session_v2')) {
    has('session_v2', ['id', 'title', 'directory', 'version', 'revert', 'fork_session_id', 'fork_boundary'])
    has('session_message', ['id', 'session_id', 'type', 'seq', 'data', 'time_created'])
    if (tables.has('session_part')) has('session_part', ['message_id', 'session_id', 'ordinal', 'type', 'data'])
    result.push({ session: 'session_v2', message: 'session_message', parts: tables.has('session_part') })
  }
  if (tables.has('session')) {
    has('session', ['id', 'title', 'directory', 'version', 'revert'])
    has('message', ['id', 'session_id', 'data', 'time_created'])
    has('part', ['id', 'message_id', 'session_id', 'data'])
    result.push({ session: 'session', message: 'message', parts: true })
  }
  if (!result.length) throw new Error('unsupported_database_layout')
  return result
}
async function open(file: string) {
  const info = await lstat(file)
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('source_changed')
  const db = new Database(file, { readonly: true, fileMustExist: true, timeout: 1000 })
  try {
    db.pragma('query_only = ON')
    db.pragma('trusted_schema = OFF')
    return db
  } catch (error) {
    db.close()
    throw error
  }
}

export const opencodeAdapter: HistorySourceAdapter = {
  source: 'opencode',
  async *discover(root, signal) {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      signal.throwIfAborted()
      if (!entry.isFile() || !['opencode.db', 'opencode-next.db'].includes(entry.name)) continue
      const file = path.join(root, entry.name)
      const db = await open(file)
      try {
        const candidates = db.transaction(() => {
          const candidates = new Map<string, { path: string; originalSessionId: string; title: string }>()
          for (const layout of layouts(db)) {
            for (const raw of db
              .prepare('SELECT id, title FROM ' + layout.session + ' ORDER BY id LIMIT 10001')
              .iterate()) {
              signal.throwIfAborted()
              const row = z.object({ id: z.string(), title: z.string().nullable() }).parse(raw)
              if (!candidates.has(row.id))
                candidates.set(row.id, { path: file, originalSessionId: row.id, title: row.title?.trim() ?? '' })
              if (candidates.size > 10_000) throw new Error('scan_limit')
            }
          }
          return [...candidates.values()]
        })()
        for (const candidate of candidates) {
          if (!candidate.title) {
            try {
              candidate.title = (await opencodeAdapter.read(candidate, signal)).title
            } catch {
              signal.throwIfAborted()
              candidate.title = candidate.originalSessionId
            }
          }
          yield candidate
        }
      } finally {
        db.close()
      }
    }
  },
  async read(ref, signal) {
    if (!ref.originalSessionId) throw new Error('unstable_identity')
    const db = await open(ref.path)
    try {
      return db.transaction(() => {
        const detected = layouts(db)
        const layout = detected.find((l) =>
          db.prepare('SELECT 1 FROM ' + l.session + ' WHERE id = ?').get(ref.originalSessionId)
        )
        if (!layout) throw new Error('source_changed')
        const sessionColumns =
          'id, title, directory, version, revert' +
          (layout.session === 'session_v2' ? ', fork_session_id, fork_boundary' : '')
        const session = Session.parse(
          db
            .prepare('SELECT ' + sessionColumns + ' FROM ' + layout.session + ' WHERE id = ?')
            .get(ref.originalSessionId)
        )
        const result: NormalizedSession = {
          source: 'opencode',
          originalSessionId: session.id,
          title: session.title ?? session.id,
          sourceVersion: session.version,
          workingDirectory: session.directory || undefined,
          sourcePaths: [ref.path],
          messages: [],
          branches: [],
          sourceFingerprint: '',
          inputBytes: 0,
          diagnostics: [],
          skippedRecords: 0,
          downgradedParts: 0
        }
        const diagnose = (code: string, id?: string, severity: 'warning' | 'error' = 'warning') =>
          result.diagnostics.push({ code, path: ref.path + (id ? '#' + id : ''), severity })
        const hash = createHash('sha256')
        const consume = (value: unknown) => {
          const data = JSON.stringify(value)
          const bytes = Buffer.byteLength(data)
          if (bytes > IMPORT_LIMITS.line) throw new Error('line_limit')
          result.inputBytes += bytes
          if (result.inputBytes > IMPORT_LIMITS.session) throw new Error('session_limit')
          hash.update(data).update('\n')
        }
        consume(layout)
        consume(session)
        const v2 = layout.session === 'session_v2'
        if (!(v2 ? /^2\.\d+\.\d+/ : /^1\.\d+\.\d+/).test(session.version))
          diagnose('unsupported_version', undefined, 'error')
        if (session.revert != null || session.fork_session_id != null || session.fork_boundary != null)
          diagnose('unsupported_history_layout', undefined, 'error')
        let lastTime: number | undefined
        let lastSeq: number | undefined
        const storage = [layout.message, ...(layout.parts ? [v2 ? 'session_part' : 'part'] : [])]
        let totalBytes = 0
        for (const table of storage) {
          const size = db
            .prepare(
              'SELECT coalesce(sum(length(CAST(data AS BLOB))), 0) AS total, coalesce(max(length(CAST(data AS BLOB))), 0) AS largest, count(*) AS count FROM ' +
                table +
                ' WHERE session_id = ?'
            )
            .get(session.id) as { total: number; largest: number; count: number }
          totalBytes += size.total
          if (size.largest > IMPORT_LIMITS.line) throw new Error('line_limit')
          if (totalBytes > IMPORT_LIMITS.session || size.count > 100_000) throw new Error('session_limit')
        }
        const order = v2 ? 'seq' : 'time_created, id'
        for (const raw of db
          .prepare(
            'SELECT id, data, time_created' +
              (v2 ? ', seq, type' : '') +
              ' FROM ' +
              layout.message +
              ' WHERE session_id = ? ORDER BY ' +
              order
          )
          .iterate(session.id)) {
          signal.throwIfAborted()
          consume(raw)
          const row = Message.parse(raw)
          let data: Record<string, unknown>
          try {
            data = ObjectData.parse(JSON.parse(row.data))
          } catch {
            diagnose('invalid_json', row.id)
            result.skippedRecords++
            continue
          }
          const type = v2 ? row.type : data.role
          const parts: MessageData['parts'] = []
          const role: 'user' | 'assistant' | 'system' =
            type === 'user' ? 'user' : type === 'assistant' ? 'assistant' : 'system'
          const partRows: Record<string, unknown>[] = []
          if (layout.parts) {
            const table = v2 ? 'session_part' : 'part'
            const partOrder = v2 ? 'ordinal' : 'id'
            let lastOrdinal: number | undefined
            for (const rawPart of db
              .prepare(
                'SELECT data' +
                  (v2 ? ', ordinal' : ', id') +
                  ' FROM ' +
                  table +
                  ' WHERE session_id = ? AND message_id = ? ORDER BY ' +
                  partOrder
              )
              .iterate(session.id, row.id)) {
              consume(rawPart)
              const part = z.object({ data: z.string(), ordinal: z.number().int().optional() }).parse(rawPart)
              if (part.ordinal !== undefined && lastOrdinal !== undefined && part.ordinal <= lastOrdinal)
                diagnose('unsupported_order', row.id, 'error')
              lastOrdinal = part.ordinal
              try {
                partRows.push(ObjectData.parse(JSON.parse(part.data)))
              } catch {
                diagnose('invalid_json', row.id)
                result.skippedRecords++
              }
            }
          }
          if (type === 'compaction' || partRows.some((p) => p.type === 'compaction')) {
            diagnose('unsupported_compaction', row.id, 'error')
            result.skippedRecords++
            continue
          }
          if (type === 'location-switched') diagnose('directory_required', row.id, 'error')
          if (['idle', 'agent-switched', 'model-switched'].includes(String(type))) continue
          if (!['user', 'assistant', 'system', 'synthetic', 'shell', 'skill'].includes(String(type))) {
            diagnose('unsupported_record', row.id)
            result.skippedRecords++
            continue
          }
          if (v2 && type === 'user' && typeof data.text === 'string') parts.push({ type: 'text', text: data.text })
          if (v2 && ['system', 'synthetic', 'skill'].includes(String(type)) && typeof data.text === 'string')
            parts.push({ type: 'text', text: '[Historical ' + String(type) + ']\n' + data.text })
          if (type === 'shell') {
            parts.push({ type: 'text', text: '[Historical shell activity]\n' + JSON.stringify(data) })
            result.downgradedParts++
          }
          const blocks = v2 ? (partRows.length ? partRows : Array.isArray(data.content) ? data.content : []) : partRows
          for (const block of blocks) {
            if (!block || typeof block !== 'object') {
              diagnose('invalid_record', row.id)
              result.skippedRecords++
              continue
            }
            if (block.ignored === true) {
              diagnose('unsupported_content', row.id)
              result.skippedRecords++
              continue
            }
            if ((block.type === 'text' || block.type === 'reasoning') && typeof block.text === 'string') {
              parts.push({ type: block.type, text: block.text })
              if (block.type === 'reasoning') diagnose('reasoning_compatibility', row.id)
            } else if (block.type === 'tool') {
              parts.push({ type: 'text', text: '[Historical tool activity]\n' + JSON.stringify(block) })
              result.downgradedParts++
            } else if (block.type === 'file') {
              const reference =
                typeof block.url === 'string' && !block.url.startsWith('data:')
                  ? block.url
                  : typeof block.filename === 'string'
                    ? block.filename
                    : ''
              parts.push({ type: 'text', text: '[Historical attachment] ' + reference })
              result.downgradedParts++
            } else {
              diagnose('unsupported_content', row.id)
              result.skippedRecords++
            }
          }
          if (Array.isArray(data.files))
            for (const file of data.files) {
              const reference = file && typeof file === 'object' ? (file.uri ?? file.name ?? '') : ''
              parts.push({
                type: 'text',
                text:
                  '[Historical attachment] ' +
                  (typeof reference === 'string' && !reference.startsWith('data:') ? reference : '')
              })
              result.downgradedParts++
            }
          if (!parts.length) {
            result.skippedRecords++
            continue
          }
          if (!Number.isFinite(new Date(row.time_created).getTime())) {
            diagnose('missing_time', row.id, 'error')
            continue
          }
          if (lastTime !== undefined && row.time_created < lastTime) diagnose('timestamp_order', row.id, 'error')
          if (v2 && (row.seq === undefined || (lastSeq !== undefined && row.seq <= lastSeq)))
            diagnose('unsupported_order', row.id, 'error')
          lastTime = row.time_created
          lastSeq = row.seq
          const model = v2
            ? z.object({ id: z.string(), providerID: z.string() }).safeParse(data.model)
            : z
                .object({ modelID: z.string(), providerID: z.string() })
                .transform((m) => ({ id: m.modelID, providerID: m.providerID }))
                .safeParse(data)
          const time = z.object({ completed: z.number().optional() }).safeParse(data.time)
          result.messages.push({
            role,
            data: { parts },
            timestamp: row.time_created,
            status: data.error
              ? 'error'
              : role === 'assistant' && (!time.success || time.data.completed === undefined)
                ? 'paused'
                : 'success',
            provenance: {
              source: 'opencode',
              originalMessageId: row.id,
              sourceOrder: row.seq ?? result.messages.length,
              originalTimestamp: new Date(row.time_created).toISOString(),
              inferredTimestamp: false
            },
            messageSnapshot:
              role === 'assistant' && model.success
                ? {
                    id: session.id,
                    name: result.title,
                    model: { id: model.data.id, name: model.data.id, provider: model.data.providerID }
                  }
                : null
          })
        }
        if (!session.title?.trim()) {
          const firstUser = result.messages.find((message) => message.role === 'user')
          result.title =
            firstUser?.data.parts
              ?.filter((part) => part.type === 'text')
              .map((part) => part.text)
              .join(' ')
              .replace(/\s+/g, ' ')
              .trim()
              .slice(0, 255) ||
            'OpenCode · ' +
              (result.messages[0] ? new Date(result.messages[0].timestamp).toISOString().slice(0, 10) : session.id)
          for (const message of result.messages)
            if (message.messageSnapshot) message.messageSnapshot.name = result.title
        }
        result.sourceFingerprint = hash.digest('hex')
        if (!result.messages.length) diagnose('empty_session', undefined, 'error')
        if (Buffer.byteLength(JSON.stringify(result)) > IMPORT_LIMITS.session) throw new Error('session_limit')
        return result
      })()
    } finally {
      db.close()
    }
  }
}
