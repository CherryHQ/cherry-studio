import { createHash } from 'node:crypto'
import { lstat, open } from 'node:fs/promises'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'

import * as z from 'zod'

import { formatCodexHistoryText, formatCodexTool, isCodexContextText } from '@data/services/importedCodexText'
import type { MessageData } from '@shared/data/types/message'

import { IMPORT_LIMITS, type NormalizedMessage, type NormalizedSession, type SessionRef } from './types'

export const CODEX_HISTORY_DB = 'thread_history_1.sqlite'
const stateFile = 'state_5.sqlite'
const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT'

async function statIfPresent(file: string) {
  try {
    return await lstat(file)
  } catch (error) {
    if (!missing(error)) throw error
    return undefined
  }
}

// A clean close can leave a WAL header without sidecars. Read that checkpoint without creating files.
async function queryDatabase<T>(file: string, query: (db: DatabaseSync) => T): Promise<T> {
  const before = await lstat(file, { bigint: true })
  if (!before.isFile() || before.isSymbolicLink()) throw new Error('source_changed')
  const wal = await statIfPresent(file + '-wal')
  const shm = await statIfPresent(file + '-shm')
  if ((wal || shm) && (!wal?.isFile() || !shm?.isFile())) throw new Error('unsupported_readonly_wal')
  let checkpoint = false
  if (!wal && !shm) {
    const handle = await open(file, 'r')
    try {
      const header = Buffer.alloc(20)
      await handle.read(header, 0, header.length, 0)
      checkpoint = header[18] === 2
    } finally {
      await handle.close()
    }
  }
  const url = pathToFileURL(file)
  url.searchParams.set('mode', 'ro')
  if (checkpoint) url.searchParams.set('immutable', '1')
  const db = new DatabaseSync(url.href, { readOnly: true })
  try {
    db.exec('PRAGMA trusted_schema = OFF; BEGIN')
    const result = query(db)
    if (checkpoint) {
      const after = await lstat(file, { bigint: true })
      if (
        before.ino !== after.ino ||
        before.size !== after.size ||
        before.mtimeNs !== after.mtimeNs ||
        before.ctimeNs !== after.ctimeNs ||
        (await statIfPresent(file + '-wal')) ||
        (await statIfPresent(file + '-shm'))
      )
        throw new Error('source_changed')
    }
    return result
  } finally {
    db.close()
  }
}

interface ThreadMetadata {
  title: string
  cwd: string
  source: string
  cli_version: string | null
}

async function metadataFor(history: string, ids: string[]) {
  const metadata = new Map<string, ThreadMetadata>()
  const file = path.join(path.dirname(history), stateFile)
  if (!(await statIfPresent(file))) return metadata
  await queryDatabase(file, (db) => {
    const columns = new Set(
      db
        .prepare('PRAGMA table_info(threads)')
        .all()
        .map((c) => c.name)
    )
    if (!columns.has('id')) return
    const title = columns.has('name') ? "COALESCE(NULLIF(name, ''), title)" : 'title'
    const fields = ['cwd', 'source', 'cli_version'].map((k) => (columns.has(k) ? k : 'NULL AS ' + k))
    const statement = db.prepare(
      'SELECT substr(' +
        (columns.has('title') ? title : 'NULL') +
        ',1,255) AS title, ' +
        fields.join(',') +
        ' FROM threads WHERE id = ?'
    )
    for (const id of ids) {
      const row = statement.get(id) as unknown as ThreadMetadata | undefined
      if (row) metadata.set(id, row)
    }
  })
  return metadata
}

function isGuardian(meta?: ThreadMetadata) {
  if (!meta?.source?.startsWith('{')) return false
  try {
    return JSON.parse(meta.source)?.subagent?.other === 'guardian'
  } catch {
    return false
  }
}

export async function databaseCandidates(root: string, rolloutIds: ReadonlySet<string>, signal: AbortSignal) {
  const file = path.join(root, CODEX_HISTORY_DB)
  if (!(await statIfPresent(file))) return []
  const ids = await queryDatabase(file, (db) =>
    db
      .prepare('SELECT DISTINCT thread_id FROM thread_items ORDER BY thread_id LIMIT 10001')
      .all()
      .map((row) => String(row.thread_id))
  )
  if (ids.length > 10_000) throw new Error('scan_limit')
  const additional = ids.filter((id) => !rolloutIds.has(id))
  const metadata = await metadataFor(file, additional)
  return additional.map((id): SessionRef => {
    signal.throwIfAborted()
    const meta = metadata.get(id)
    return {
      path: file,
      originalSessionId: id,
      title: meta?.title?.trim() || 'Codex · ' + id,
      filteredReason: isGuardian(meta) ? 'codex_guardian_review' : undefined
    }
  })
}

const object = z.record(z.string(), z.unknown())
const textParts = z.array(z.string())
const citations = z.object({
  entries: z.array(
    z.object({
      path: z.string(),
      lineStart: z.number().int(),
      lineEnd: z.number().int(),
      note: z.string()
    })
  )
})
const questions = z.array(z.object({ title: z.string(), options: z.array(z.string()).nullish() }))

function historicalJson(value: unknown) {
  return JSON.stringify(value, function (key, v: unknown) {
    if (
      typeof v === 'string' &&
      (v.startsWith('data:') || key === 'blob' || (key === 'data' && ['image', 'audio'].includes(this.type)))
    )
      return '[Historical attachment]'
    return v
  })
}

function itemContent(item: Record<string, unknown>): Pick<NormalizedMessage, 'role' | 'data'> | undefined {
  const parts: MessageData['parts'] = []
  let role: NormalizedMessage['role'] = 'system'
  if (item.type === 'userMessage' && Array.isArray(item.content)) {
    role =
      item.content.length &&
      item.content.every(
        (block) => block?.type === 'text' && typeof block.text === 'string' && isCodexContextText(block.text)
      )
        ? 'system'
        : 'user'
    for (const block of item.content) {
      if (block?.type === 'text' && typeof block.text === 'string')
        parts.push({ type: 'text', text: formatCodexHistoryText(block.text, role) })
      else if (block && typeof block === 'object') {
        const ref = block.path ?? block.url
        parts.push({
          type: 'text',
          text: '[Historical attachment]' + (typeof ref === 'string' && !ref.startsWith('data:') ? ' ' + ref : '')
        })
      }
    }
  } else if (item.type === 'agentMessage' || item.type === 'plan') {
    role = 'assistant'
    let text = typeof item.text === 'string' ? item.text : ''
    const refs = citations.safeParse(item.memoryCitation)
    if (refs.success && refs.data.entries.length)
      text +=
        '\n\n[Historical references]\n\n' +
        refs.data.entries.map((e) => e.path + ':' + e.lineStart + '-' + e.lineEnd + ' — ' + e.note).join('\n')
    const prompts = questions.safeParse(item.questions)
    if (prompts.success) for (const q of prompts.data) text += '\n\n' + [q.title, ...(q.options ?? [])].join('\n')
    if (text.trim()) parts.push({ type: 'text', text: formatCodexHistoryText(text.trim(), role) })
  } else if (item.type === 'reasoning') {
    role = 'assistant'
    for (const field of [item.summary, item.content]) {
      const lines = textParts.safeParse(field)
      if (lines.success && lines.data.length) parts.push({ type: 'reasoning', text: lines.data.join('\n') })
    }
  } else if (item.type === 'commandExecution' || item.type === 'mcpToolCall') {
    const shell = item.type === 'commandExecution'
    parts.push({
      type: 'text',
      text: formatCodexTool({
        type: 'function_call',
        name: shell ? 'shell' : item.tool,
        input: shell ? item.command : historicalJson(item.arguments)
      })
    })
    const output = shell ? item.aggregatedOutput : (item.error ?? item.result)
    if (output != null)
      parts.push({
        type: 'text',
        text: formatCodexTool({
          type: 'function_call_output',
          output: typeof output === 'string' ? output : historicalJson(output)
        })
      })
  } else if (item.type === 'imageGeneration' || item.type === 'imageView') {
    const ref = item.savedPath ?? item.path
    parts.push({
      type: 'text',
      text: '[Historical attachment]' + (typeof ref === 'string' && !ref.startsWith('data:') ? ' ' + ref : '')
    })
  } else if (typeof item.type === 'string' && !['userMessage', 'sleep', 'contextCompaction'].includes(item.type)) {
    // Retain other projected activities as inert history, including file edits and search results.
    parts.push({ type: 'text', text: '[Historical tool activity]\n' + historicalJson(item) })
  }
  return parts.length ? { role, data: { parts } } : undefined
}

interface ItemRow {
  item_id: string
  rollout_ordinal: number
  created_at_ms: number
  item_json: string | null
}

export async function readDatabaseSession(ref: SessionRef, signal: AbortSignal): Promise<NormalizedSession> {
  const id = ref.originalSessionId
  if (!id) throw new Error('unstable_identity')
  const meta = (await metadataFor(ref.path, [id])).get(id)
  const hash = createHash('sha256').update(JSON.stringify(meta ?? null))
  const session: NormalizedSession = {
    source: 'codex',
    originalSessionId: id,
    title: meta?.title?.trim() || 'Codex · ' + id,
    workingDirectory: meta?.cwd || undefined,
    sourceVersion: meta?.cli_version ?? undefined,
    sourcePaths: [ref.path, ...(meta ? [path.join(path.dirname(ref.path), stateFile)] : [])],
    filteredReason: isGuardian(meta) ? 'codex_guardian_review' : undefined,
    messages: [],
    branches: [],
    sourceFingerprint: '',
    inputBytes: 0,
    diagnostics: [],
    skippedRecords: 0,
    downgradedParts: 0
  }
  await queryDatabase(ref.path, (db) => {
    const rows = db.prepare(
      `SELECT item_id, rollout_ordinal, created_at_ms, CASE WHEN octet_length(item_json) <= ? THEN item_json END AS item_json
       FROM thread_items WHERE thread_id = ? ORDER BY rollout_ordinal`
    )
    for (const row of rows.iterate(IMPORT_LIMITS.line, id) as unknown as Iterable<ItemRow>) {
      signal.throwIfAborted()
      if (row.item_json === null) throw new Error('line_limit')
      session.inputBytes += Buffer.byteLength(row.item_json)
      if (session.inputBytes > IMPORT_LIMITS.session) throw new Error('session_limit')
      hash.update(JSON.stringify([row.item_id, row.rollout_ordinal, row.created_at_ms])).update(row.item_json)
      let item: Record<string, unknown>
      try {
        item = object.parse(JSON.parse(row.item_json))
      } catch {
        session.diagnostics.push({
          severity: 'warning',
          code: 'invalid_record',
          path: ref.path,
          line: row.rollout_ordinal + 1
        })
        session.skippedRecords++
        continue
      }
      const content = itemContent(item)
      if (!content) {
        session.skippedRecords++
        continue
      }
      const timestamp = row.created_at_ms
      if (!Number.isSafeInteger(timestamp) || !Number.isFinite(new Date(timestamp).getTime()))
        throw new Error('missing_time')
      if (content.role === 'system' && item.type !== 'userMessage')
        session.downgradedParts += content.data.parts?.length ?? 0
      session.messages.push({
        ...content,
        timestamp,
        status:
          item.status === 'failed'
            ? 'error'
            : item.status === 'inProgress' || item.status === 'interrupted'
              ? 'paused'
              : 'success',
        provenance: {
          source: 'codex',
          originalMessageId: row.item_id,
          sourceOrder: row.rollout_ordinal,
          originalTimestamp: new Date(timestamp).toISOString(),
          inferredTimestamp: false
        },
        messageSnapshot: null
      })
    }
  })
  if (!session.messages.length) session.diagnostics.push({ severity: 'error', code: 'empty_session', path: ref.path })
  if (Buffer.byteLength(JSON.stringify(session)) > IMPORT_LIMITS.session) throw new Error('session_limit')
  session.sourceFingerprint = hash.digest('hex')
  return session
}
