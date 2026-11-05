import { createHash } from 'node:crypto'
import { lstat, open, readdir, realpath } from 'node:fs/promises'
import path from 'node:path'

import Database from 'better-sqlite3'
import * as z from 'zod'

import { formatClaudeTool } from '@data/services/importedHistoryText'
import type { MessageData } from '@shared/data/types/message'

import { readJsonl } from './files'
import { IMPORT_LIMITS, type HistorySourceAdapter, type NormalizedSession } from './types'

const requiredColumns = [
  'id',
  'cwd',
  'title',
  'custom_title',
  'transport',
  'deleted_at',
  'created_at',
  'updated_at',
  'last_activity_at'
]
const optionalColumns = ['is_background_automation', 'conversation_origin']
const IndexRow = z.object({
  id: z.string().min(1),
  cwd: z.string().nullable(),
  title: z.string().nullable(),
  custom_title: z.string().nullable(),
  transport: z.string(),
  deleted_at: z.number().nullable(),
  created_at: z.number(),
  updated_at: z.number(),
  last_activity_at: z.number().nullable(),
  is_background_automation: z.number().nullable().optional(),
  conversation_origin: z.string().nullable().optional()
})
const Record = z.object({
  type: z.string(),
  id: z.string().min(1),
  sessionId: z.string().min(1),
  parentId: z.string().nullable().optional(),
  timestamp: z
    .number()
    .int()
    .nonnegative()
    .refine((value) => Number.isFinite(new Date(value).getTime())),
  cwd: z.string().optional(),
  role: z.string().optional(),
  content: z.array(z.unknown()).optional(),
  rawContent: z.array(z.unknown()).optional(),
  name: z.string().optional(),
  callId: z.string().optional(),
  arguments: z.string().optional(),
  output: z.unknown().optional(),
  status: z.string().optional(),
  providerData: z.record(z.string(), z.unknown()).optional()
})
const TextPart = z.object({ type: z.string(), text: z.string() })
const metadata = new Set(['session-meta', 'ai-title', 'file-history-snapshot'])
const bodyTypes = new Set(['message', 'reasoning', 'function_call', 'function_call_result'])

async function openIndex(file: string) {
  const info = await lstat(file)
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('source_changed')
  const handle = await open(file, 'r')
  const header = Buffer.alloc(20)
  try {
    await handle.read(header, 0, header.length, 0)
  } finally {
    await handle.close()
  }
  if (header[18] === 2) {
    for (const suffix of ['-wal', '-shm']) {
      try {
        const sidecar = await lstat(file + suffix)
        if (!sidecar.isFile() || sidecar.isSymbolicLink()) throw new Error('unsupported_readonly_wal')
      } catch {
        throw new Error('unsupported_readonly_wal')
      }
    }
  }
  const db = new Database(file, { readonly: true, fileMustExist: true, timeout: 1000 })
  try {
    db.pragma('query_only = ON')
    db.pragma('trusted_schema = OFF')
    const columns = new Set(
      (db.prepare('PRAGMA table_info(sessions)').all() as { name: string }[]).map((row) => row.name)
    )
    if (requiredColumns.some((column) => !columns.has(column))) throw new Error('unsupported_database_layout')
    const selected = [...requiredColumns, ...optionalColumns.filter((column) => columns.has(column))]
    return { db, selected }
  } catch (error) {
    db.close()
    throw error
  }
}

function indexBytes(selected: string[]) {
  return selected.map((column) => 'coalesce(length(CAST(' + column + ' AS BLOB)), 0)').join(' + ')
}

function readIndex(db: Database.Database, selected: string[], id: string) {
  return db.transaction(() => {
    const size = db.prepare('SELECT ' + indexBytes(selected) + ' AS bytes FROM sessions WHERE id = ?').get(id) as
      | { bytes: number }
      | undefined
    if (!size) throw new Error('source_changed')
    if (size.bytes > IMPORT_LIMITS.line) throw new Error('line_limit')
    return IndexRow.parse(db.prepare('SELECT ' + selected.join(', ') + ' FROM sessions WHERE id = ?').get(id))
  })()
}

async function transcript(root: string, id: string, signal: AbortSignal): Promise<string> {
  if (/[\\/]/.test(id) || id.includes('\0') || id === '.' || id === '..') throw new Error('unstable_identity')
  const projects = path.join(root, 'projects')
  const info = await lstat(projects).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') throw new Error('unsupported_missing_history')
    throw error
  })
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('source_changed')
  const matches: string[] = []
  let scanned = 0
  for (const project of await readdir(projects, { withFileTypes: true })) {
    signal.throwIfAborted()
    if (++scanned > 10_000) throw new Error('scan_limit')
    if (!project.isDirectory() || project.isSymbolicLink()) continue
    const candidate = path.join(projects, project.name, id + '.jsonl')
    try {
      const file = await lstat(candidate)
      if (!file.isFile() || file.isSymbolicLink()) throw new Error('source_changed')
      const canonical = await realpath(candidate)
      const relative = path.relative(root, canonical)
      if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative))
        throw new Error('source_changed')
      matches.push(canonical)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  if (matches.length > 1) throw new Error('identity_conflict')
  if (!matches.length) throw new Error('unsupported_missing_history')
  return matches[0]
}

function sameDirectory(left: string, right: string): boolean {
  if (!right) return !left
  const windowsPath = /^(?:[a-z]:[\\/]|\\\\)/i
  if (windowsPath.test(left) && windowsPath.test(right))
    return path.win32.normalize(left).toLowerCase() === path.win32.normalize(right).toLowerCase()
  return path.posix.normalize(left) === path.posix.normalize(right)
}

function userEnvelope(text: string, generated: boolean): { text: string; context?: string } {
  if (!generated) return { text }
  const wrapped =
    /^(\s*(?:<system-reminder data-role="(?:user-context|additional-data)">[\s\S]*?<\/system-reminder>\s*)*)<user_query>([\s\S]*)<\/user_query>\s*$/.exec(
      text
    )
  if (!wrapped || /<\/?user_query>/.test(wrapped[2])) return { text }
  return { text: wrapped[2].trim(), context: wrapped[1].trim() || undefined }
}

export const workbuddyAdapter: HistorySourceAdapter = {
  source: 'workbuddy',
  async *discover(root, signal) {
    const file = path.join(root, 'workbuddy.db')
    const { db, selected } = await openIndex(file)
    try {
      const rows = db.transaction(() => {
        const ids: string[] = []
        let bytes = 0
        for (const raw of db
          .prepare('SELECT id, ' + indexBytes(selected) + ' AS bytes FROM sessions ORDER BY id LIMIT 10001')
          .iterate()) {
          signal.throwIfAborted()
          const row = z.object({ id: z.string(), bytes: z.number() }).parse(raw)
          if (row.bytes > IMPORT_LIMITS.line) throw new Error('line_limit')
          bytes += row.bytes
          if (bytes > IMPORT_LIMITS.batch) throw new Error('batch_limit')
          ids.push(row.id)
          if (ids.length > 10_000) throw new Error('scan_limit')
        }
        const statement = db.prepare('SELECT ' + selected.join(', ') + ' FROM sessions WHERE id = ?')
        return ids.map((id) => IndexRow.parse(statement.get(id)))
      })()
      for (const row of rows) {
        signal.throwIfAborted()
        if (row.transport === 'local' && row.deleted_at !== null) continue
        if (row.transport === 'cloud' && row.deleted_at !== -1 && row.deleted_at !== null) continue
        const ref = {
          path: file,
          originalSessionId: row.id,
          title: row.custom_title?.trim() || row.title?.trim() || ''
        }
        if (!ref.title && row.transport === 'local') {
          try {
            ref.title = (await workbuddyAdapter.read(ref, signal)).title
          } catch {
            signal.throwIfAborted()
          }
        }
        yield { ...ref, title: ref.title || 'WorkBuddy · ' + new Date(row.created_at).toISOString().slice(0, 10) }
      }
    } finally {
      db.close()
    }
  },
  async read(ref, signal) {
    signal.throwIfAborted()
    if (!ref.originalSessionId) throw new Error('unstable_identity')
    const { db, selected } = await openIndex(ref.path)
    try {
      const row = readIndex(db, selected, ref.originalSessionId)
      if (row.transport !== 'local') throw new Error('unsupported_cloud_history')
      if (row.deleted_at !== null) throw new Error('source_changed')
      if (row.is_background_automation) throw new Error('unsupported_history_layout')
      const root = await realpath(path.dirname(ref.path))
      const file = await transcript(root, row.id, signal)
      const identity = await lstat(file)
      const input = await readJsonl(file, signal)
      const result: NormalizedSession = {
        source: 'workbuddy',
        originalSessionId: row.id,
        sourcePaths: [ref.path, file],
        title: row.custom_title?.trim() || row.title?.trim() || '',
        workingDirectory: row.cwd || undefined,
        messages: [],
        branches: [],
        sourceFingerprint: '',
        inputBytes: input.bytes + Buffer.byteLength(JSON.stringify(row)),
        diagnostics: [],
        skippedRecords: 0,
        downgradedParts: 0
      }
      if (result.inputBytes > IMPORT_LIMITS.session) throw new Error('session_limit')
      const diagnose = (code: string, line: number, severity: 'error' | 'warning' = 'error') =>
        result.diagnostics.push({ code, line, path: file, severity })
      const ids = new Set<string>()
      const calls = new Map<string, string>()
      const completed = new Set<string>()
      let parent: string | undefined
      for (const { text, line } of input.lines) {
        signal.throwIfAborted()
        if (!text.trim()) continue
        let raw: unknown
        try {
          raw = JSON.parse(text)
        } catch {
          diagnose('invalid_record', line)
          continue
        }
        const kind = z.object({ type: z.string() }).safeParse(raw)
        if (!kind.success) {
          diagnose('invalid_record', line)
          continue
        }
        if (metadata.has(kind.data.type)) {
          result.skippedRecords++
          continue
        }
        if (!bodyTypes.has(kind.data.type)) {
          diagnose('unsupported_record', line)
          continue
        }
        const parsed = Record.safeParse(raw)
        if (!parsed.success) {
          diagnose('invalid_record', line)
          continue
        }
        const record = parsed.data
        if (record.sessionId !== row.id || ids.has(record.id)) {
          diagnose('identity_conflict', line)
          continue
        }
        ids.add(record.id)
        if ((record.parentId || undefined) !== parent) diagnose('unsupported_history_layout', line)
        parent = record.id
        if (record.cwd && !sameDirectory(record.cwd, row.cwd ?? '')) diagnose('directory_required', line)
        const provider = record.providerData ?? {}
        const status =
          record.status === 'incomplete' || provider.isPartialAborted === true
            ? 'paused'
            : record.status === 'failed' || record.status === 'error'
              ? 'error'
              : 'success'
        if (record.status && !['completed', 'incomplete', 'failed', 'error'].includes(record.status))
          diagnose('unsupported_record', line)
        const actualModel = typeof provider.model === 'string' && provider.model.trim() ? provider.model : undefined
        const requestedModel = typeof provider.requestModelId === 'string' ? provider.requestModelId : undefined
        const model = actualModel ?? requestedModel
        const modelName =
          actualModel && actualModel !== requestedModel
            ? actualModel
            : typeof provider.requestModelName === 'string'
              ? 'WorkBuddy · ' + provider.requestModelName
              : model
        const append = (role: 'user' | 'assistant' | 'system', parts: NonNullable<MessageData['parts']>) => {
          result.messages.push({
            role,
            data: { parts },
            status,
            timestamp: record.timestamp,
            provenance: {
              source: 'workbuddy',
              originalMessageId: record.id,
              sourceOrder: result.messages.length,
              originalTimestamp: new Date(record.timestamp).toISOString(),
              inferredTimestamp: false
            },
            messageSnapshot: model
              ? {
                  id: row.id,
                  name: result.title,
                  model: {
                    id: model,
                    name: modelName ?? model,
                    provider: 'workbuddy'
                  }
                }
              : null
          })
        }
        if (record.type === 'message' || record.type === 'reasoning') {
          if (record.type === 'message' && !['user', 'assistant'].includes(record.role ?? '')) {
            diagnose('unsupported_record', line)
            continue
          }
          const parts: NonNullable<MessageData['parts']> = []
          const blocks = record.type === 'reasoning' ? record.rawContent : record.content
          if (!blocks?.length) diagnose('unsupported_content', line)
          for (const block of blocks ?? []) {
            const parsedText = TextPart.safeParse(block)
            const expected =
              record.type === 'reasoning' ? 'reasoning_text' : record.role === 'user' ? 'input_text' : 'output_text'
            if (!parsedText.success || parsedText.data.type !== expected) {
              diagnose('unsupported_content', line)
              continue
            }
            if (record.role === 'user') {
              const envelope = userEnvelope(parsedText.data.text, provider.startsNewUserRequest === true)
              if (envelope.context) append('system', [{ type: 'text', text: envelope.context }])
              parts.push({ type: 'text', text: envelope.text })
              if (!result.title && envelope.text.trim()) result.title = envelope.text.trim().slice(0, 255)
            } else parts.push({ type: record.type === 'reasoning' ? 'reasoning' : 'text', text: parsedText.data.text })
          }
          if (parts.length) append(record.role === 'user' ? 'user' : 'assistant', parts)
        } else if (record.type === 'function_call') {
          if (!record.callId || !record.name || calls.has(record.callId)) {
            diagnose('unsupported_tool_history', line)
            continue
          }
          calls.set(record.callId, record.name)
          let argumentsValue: unknown
          try {
            argumentsValue = JSON.parse(record.arguments ?? '')
          } catch {
            diagnose('unsupported_tool_history', line)
            continue
          }
          append('system', [
            {
              type: 'text',
              text:
                formatClaudeTool({ type: 'tool_use', name: record.name, input: argumentsValue }) +
                '\n\nCall ID: ' +
                record.callId
            }
          ])
        } else {
          if (
            !record.callId ||
            !calls.has(record.callId) ||
            completed.has(record.callId) ||
            (record.name && record.name !== calls.get(record.callId))
          ) {
            diagnose('unsupported_tool_history', line)
            continue
          }
          completed.add(record.callId)
          const outputs = Array.isArray(record.output) ? record.output : [record.output]
          const output = outputs
            .map((value) => {
              const parsedText = TextPart.safeParse(value)
              if (parsedText.success && parsedText.data.type === 'text') return parsedText.data.text
              if (typeof value === 'string') return value
              result.downgradedParts++
              diagnose('unsupported_tool_output', line, 'warning')
              if (value && typeof value === 'object' && 'type' in value)
                return '[Historical unsupported artifact: ' + String(value.type) + ']'
              return JSON.stringify(value ?? null, null, 2)
            })
            .join('\n\n')
          append('system', [
            {
              type: 'text',
              text: formatClaudeTool(
                { type: 'tool_result', content: output + '\n\nCall ID: ' + record.callId },
                calls.get(record.callId)
              )
            }
          ])
        }
      }
      if (!result.messages.length) diagnose('empty_session', 0)
      if ([...calls.keys()].some((id) => !completed.has(id))) diagnose('unsupported_tool_history', 0)
      result.title ||= 'WorkBuddy · ' + new Date(row.created_at).toISOString().slice(0, 10)
      const after = await readJsonl(file, signal)
      const finalIdentity = await lstat(file)
      if (
        JSON.stringify(readIndex(db, selected, row.id)) !== JSON.stringify(row) ||
        after.fingerprint !== input.fingerprint ||
        identity.ino !== finalIdentity.ino ||
        identity.dev !== finalIdentity.dev ||
        identity.size !== finalIdentity.size ||
        (await transcript(root, row.id, signal)) !== file
      )
        throw new Error('source_changed')
      result.sourceFingerprint = createHash('sha256')
        .update(
          JSON.stringify({ selected, row, file, ino: identity.ino, dev: identity.dev, fingerprint: input.fingerprint })
        )
        .digest('hex')
      if (Buffer.byteLength(JSON.stringify(result)) > IMPORT_LIMITS.session) throw new Error('session_limit')
      return result
    } finally {
      db.close()
    }
  }
}
