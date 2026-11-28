import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { realpath } from 'node:fs/promises'
import path from 'node:path'
import { constants, createZstdDecompress } from 'node:zlib'

import * as z from 'zod'

import { formatCodexHistoryText, formatCodexTool, isCodexContextText } from '@data/services/importedCodexText'
import type { MessageData } from '@shared/data/types/message'

import { queryReadonlyDatabase, statIfPresent } from './readonlySqlite'
import { IMPORT_LIMITS, type NormalizedMessage, type NormalizedSession, type SessionRef } from './types'

export const CODEX_HISTORY_DB = 'thread_history_1.sqlite'
const stateFile = 'state_5.sqlite'
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
  await queryReadonlyDatabase(file, (db) => {
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

export async function databaseCandidates(
  root: string,
  rolloutIds: ReadonlySet<string>,
  compressed: ReadonlyMap<string, string[]>,
  signal: AbortSignal
) {
  const file = path.join(root, CODEX_HISTORY_DB)
  if (!(await statIfPresent(file))) return []
  const ids = await queryReadonlyDatabase(file, (db) =>
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
      sourcePaths: [file, ...(compressed.get(id) ?? [])],
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

// SQLite projects only local items. The source header establishes whether an ancestor range is also visible.
async function readRootHeader(ref: SessionRef, signal: AbortSignal) {
  const archives = ref.sourcePaths?.filter((file) => file.endsWith('.jsonl.zst')) ?? []
  if (archives.length !== 1) throw new Error('unsupported_history_layout')
  const [archive] = archives
  if ((await realpath(archive)) !== archive) throw new Error('source_changed')
  const source = createReadStream(archive, { signal, end: IMPORT_LIMITS.session - 1 })
  const decoded = source.compose(createZstdDecompress({ params: { [constants.ZSTD_d_windowLogMax]: 25 } }), { signal })
  const chunks: Buffer[] = []
  let size = 0
  try {
    for await (const chunk of decoded) {
      const bytes = chunk as Buffer
      const end = bytes.indexOf(10)
      const part = end < 0 ? bytes : bytes.subarray(0, end)
      size += part.length
      if (size > IMPORT_LIMITS.line) throw new Error('line_limit')
      chunks.push(part)
      if (end < 0) continue
      const header = Buffer.concat(chunks, size)
      const row = JSON.parse(header.toString('utf8'))
      if (row?.type !== 'session_meta' || row.payload?.id !== ref.originalSessionId)
        throw new Error('unstable_identity')
      if (typeof row.payload.cli_version !== 'string' || !/^0\.\d+\.\d+(?:[-+].*)?$/.test(row.payload.cli_version))
        throw new Error('unsupported_version')
      if (row.ordinal !== 0 || row.payload.history_mode !== 'paginated' || row.payload.history_base != null)
        throw new Error('unsupported_history_layout')
      return header
    }
    throw new Error('unsupported_history_layout')
  } finally {
    decoded.destroy()
    source.destroy()
  }
}

export async function readDatabaseSession(ref: SessionRef, signal: AbortSignal): Promise<NormalizedSession> {
  const id = ref.originalSessionId
  if (!id) throw new Error('unstable_identity')
  const header = await readRootHeader(ref, signal)
  const meta = (await metadataFor(ref.path, [id])).get(id)
  const hash = createHash('sha256')
    .update(header)
    .update(JSON.stringify(meta ?? null))
  const session: NormalizedSession = {
    source: 'codex',
    originalSessionId: id,
    title: meta?.title?.trim() || 'Codex · ' + id,
    workingDirectory: meta?.cwd || undefined,
    sourceVersion: meta?.cli_version ?? undefined,
    sourcePaths: [...(ref.sourcePaths ?? [ref.path]), ...(meta ? [path.join(path.dirname(ref.path), stateFile)] : [])],
    filteredReason: isGuardian(meta) ? 'codex_guardian_review' : undefined,
    messages: [],
    branches: [],
    sourceFingerprint: '',
    inputBytes: header.length,
    diagnostics: [],
    skippedRecords: 0,
    downgradedParts: 0
  }
  await queryReadonlyDatabase(ref.path, (db) => {
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
          isSetup: item.type === 'userMessage' && content.role === 'system' ? true : undefined,
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
