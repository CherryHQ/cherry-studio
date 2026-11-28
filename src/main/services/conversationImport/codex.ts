import { createHash } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import path from 'node:path'

import * as z from 'zod'

import { application } from '@application'
import { formatCodexHistoryText, formatCodexTool, isCodexContextText } from '@data/services/importedCodexText'
import { loggerService } from '@logger'
import type { MessageData } from '@shared/data/types/message'

import { CODEX_HISTORY_DB, databaseCandidates, readDatabaseSession } from './codexDatabase'
import { discoverJsonl, readJsonl } from './files'
import { statIfPresent } from './readonlySqlite'
import { IMPORT_LIMITS, type HistorySourceAdapter, type NormalizedSession, type SessionRef } from './types'

const Row = z.object({
  ordinal: z.number().int().nonnegative().optional(),
  timestamp: z.string().optional(),
  type: z.string(),
  payload: z.record(z.string(), z.unknown())
})
const Meta = z
  .object({
    id: z.string().min(1),
    cli_version: z.string(),
    cwd: z.string().optional(),
    history_mode: z.string().optional(),
    history_base: z.unknown().optional(),
    model_provider: z.string().nullish()
  })
  .passthrough()

async function indexInput(file: string, signal: AbortSignal) {
  let input
  try {
    input = await readJsonl(file, signal)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const titles = new Map<string, string>()
  const invalidLines: number[] = []
  for (const row of input?.lines ?? []) {
    try {
      const entry = JSON.parse(row.text)
      if (typeof entry.id === 'string' && typeof entry.thread_name === 'string' && entry.thread_name.trim())
        titles.set(entry.id, entry.thread_name)
    } catch {
      invalidLines.push(row.line)
    }
  }
  return { titles, invalidLines, bytes: input?.bytes ?? 0, fingerprint: input?.fingerprint ?? 'absent' }
}

async function* rolloutFiles(root: string, signal: AbortSignal) {
  const home = await realpath(application.getPath('external.codex.home')).catch(() => undefined)
  if (root !== home) {
    yield* discoverJsonl(root, signal, true)
    return
  }
  for (const name of ['sessions', 'archived_sessions']) {
    const directory = path.join(root, name)
    if ((await statIfPresent(directory))?.isDirectory()) yield* discoverJsonl(directory, signal, true)
  }
}

export const codexAdapter: HistorySourceAdapter = {
  source: 'codex',
  async *discover(root, signal) {
    const indexPath = path.join(root, 'session_index.jsonl')
    const index = await indexInput(indexPath, signal)
    const sessions = new Map<string, SessionRef & { sourcePaths: string[]; originalSessionId: string }>()
    const compressed = new Map<string, string[]>()
    const rolloutIds = new Set<string>()
    let scanned = 0
    for await (const file of rolloutFiles(root, signal)) {
      if (++scanned > 10_000) throw new Error('scan_limit')
      const name = path.basename(file)
      if (!name.startsWith('rollout-')) continue
      if (name.endsWith('.jsonl.zst')) {
        const id = /-([\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12})\.jsonl\.zst$/i.exec(name)?.[1]
        if (id) {
          const paths = compressed.get(id) ?? []
          paths.push(file)
          compressed.set(id, paths)
        }
        continue
      }
      let id = file
      try {
        const input = await readJsonl(file, signal)
        for (const line of input.lines) {
          let value
          try {
            value = JSON.parse(line.text)
          } catch {
            continue
          }
          if (value?.type !== 'session_meta' || typeof value.payload?.id !== 'string' || !value.payload.id) continue
          rolloutIds.add(value.payload.id)
          if (id === file && Row.safeParse(value).success) id = value.payload.id
        }
      } catch {
        signal.throwIfAborted()
      }
      const existing = sessions.get(id)
      if (existing) existing.sourcePaths.push(file)
      else
        sessions.set(id, {
          path: file,
          sourcePaths: [indexPath, file],
          originalSessionId: id,
          title: index.titles.get(id)
        })
      if (sessions.size > 10_000) throw new Error('scan_limit')
    }
    for (const ref of sessions.values()) {
      try {
        const session = await readCodexSession(ref, signal, index)
        if (
          !session.title.trim() &&
          session.diagnostics.some(
            (d) =>
              d.severity === 'error' &&
              ['unstable_identity', 'identity_conflict', 'duplicate_message_id'].includes(d.code)
          )
        ) {
          continue
        }
        ref.title = session.title
        ref.filteredReason = session.filteredReason
      } catch {
        signal.throwIfAborted()
      }
      yield ref
    }
    try {
      yield* await databaseCandidates(root, rolloutIds, compressed, signal)
    } catch (error) {
      signal.throwIfAborted()
      if (!sessions.size || (error instanceof Error && error.message === 'scan_limit')) throw error
      loggerService
        .withContext('CodexHistoryImport')
        .warn('Could not discover SQLite history alongside rollouts', { error })
    }
  },
  read: (ref, signal) =>
    path.basename(ref.path) === CODEX_HISTORY_DB ? readDatabaseSession(ref, signal) : readCodexSession(ref, signal)
}

async function readCodexSession(
  ref: SessionRef,
  signal: AbortSignal,
  discoveredIndex?: Awaited<ReturnType<typeof indexInput>>
) {
  const input = await readJsonl(ref.path, signal)
  const result: NormalizedSession = {
    source: 'codex',
    originalSessionId: '',
    sourcePaths: [ref.path],
    title: ref.title ?? '',
    messages: [],
    branches: [],
    sourceFingerprint: '',
    inputBytes: input.bytes,
    diagnostics: [],
    skippedRecords: 0,
    downgradedParts: 0
  }
  const diagnose = (code: string, line?: number, severity: 'warning' | 'error' = 'warning') =>
    result.diagnostics.push({ code, line, severity, path: ref.path })
  const dependencies = ref.sourcePaths ?? [ref.path]
  if (dependencies.filter((p) => path.basename(p).startsWith('rollout-')).length > 1)
    diagnose('unsupported_history_layout', undefined, 'error')
  const indexPath = dependencies.find((p) => path.basename(p) === 'session_index.jsonl')
  const index = discoveredIndex ?? (indexPath ? await indexInput(indexPath, signal) : undefined)
  result.sourcePaths = dependencies
  result.inputBytes += index?.bytes ?? 0
  if (result.inputBytes > IMPORT_LIMITS.session) throw new Error('session_limit')
  result.sourceFingerprint = createHash('sha256')
    .update(input.fingerprint)
    .update(index?.fingerprint ?? 'absent')
    .digest('hex')
  const rows: { row: z.infer<typeof Row>; line: number }[] = []
  for (const entry of input.lines) {
    signal.throwIfAborted()
    if (!entry.text.trim()) continue
    try {
      const row = Row.safeParse(JSON.parse(entry.text))
      if (!row.success) {
        diagnose('invalid_record', entry.line)
        result.skippedRecords++
        continue
      }
      rows.push({ row: row.data, line: entry.line })
    } catch {
      // An unfinished append can become valid on retry. Do not reserve the thread ID for its prefix.
      diagnose('invalid_json', entry.line, entry.line === input.unterminatedLine ? 'error' : 'warning')
      result.skippedRecords++
    }
  }
  const metas = rows.filter(({ row }) => row.type === 'session_meta')
  const meta = metas.length === 1 ? Meta.safeParse(metas[0].row.payload) : undefined
  if (!meta?.success) {
    diagnose('unstable_identity', undefined, 'error')
    return result
  }
  result.originalSessionId = meta.data.id
  if (ref.originalSessionId && ref.originalSessionId !== meta.data.id) diagnose('unstable_identity', undefined, 'error')
  result.sourceVersion = meta.data.cli_version
  result.workingDirectory = meta.data.cwd
  if (!/^0\.\d+\.\d+(?:[-+].*)?$/.test(meta.data.cli_version)) diagnose('unsupported_version', undefined, 'error')
  if (
    (meta.data.history_mode && !['legacy', 'paginated'].includes(meta.data.history_mode)) ||
    meta.data.history_base != null
  )
    diagnose('unsupported_history_layout', undefined, 'error')
  if (meta.data.history_mode === 'paginated' && rows.some(({ row }, index) => row.ordinal !== index))
    diagnose('unsupported_history_order', undefined, 'error')
  result.title = index?.titles.get(result.originalSessionId) ?? ''
  for (const line of index?.invalidLines ?? [])
    result.diagnostics.push({ code: 'invalid_json', path: indexPath!, line, severity: 'warning' })
  let model: string | undefined
  let lastTime: number | undefined
  const directories = new Set(result.workingDirectory ? [result.workingDirectory] : [])
  const ids = new Set<string>()
  for (const { row, line } of rows) {
    signal.throwIfAborted()
    const item = row.payload
    if (row.type === 'session_meta') continue
    if (row.type === 'turn_context') {
      if (typeof item.model === 'string') model = item.model
      if (typeof item.cwd === 'string') directories.add(item.cwd)
      continue
    }
    if (row.type === 'event_msg') {
      if (item.type === 'thread_rolled_back') diagnose('unsupported_history_layout', line, 'error')
      continue
    }
    if (row.type !== 'response_item') {
      diagnose(
        'unsupported_record',
        line,
        ['compacted', 'retained_context', 'realtime_item'].includes(row.type) ? 'error' : 'warning'
      )
      result.skippedRecords++
      continue
    }
    if (item.encrypted_content) {
      diagnose('unsupported_encrypted_history', line, item.type === 'reasoning' ? 'warning' : 'error')
      if (item.type === 'reasoning') result.downgradedParts++
    }
    const parts: MessageData['parts'] = []
    let role: 'user' | 'assistant' | 'system' = 'system'
    if (item.type === 'message') {
      if (item.role !== 'user' && item.role !== 'assistant') {
        // Source policy is not the selected target agent's policy.
        diagnose('unsupported_record', line)
        result.skippedRecords++
        continue
      }
      role = item.role
      if (
        role === 'user' &&
        Array.isArray(item.content) &&
        item.content.length &&
        item.content.every((block) => block && typeof block.text === 'string' && isCodexContextText(block.text))
      )
        role = 'system'
      if (!Array.isArray(item.content)) {
        diagnose('invalid_record', line, 'error')
        continue
      }
      for (const block of item.content) {
        if (!block || typeof block !== 'object') {
          diagnose('invalid_record', line, 'error')
          continue
        }
        if (['input_text', 'output_text'].includes(block.type) && typeof block.text === 'string')
          parts.push({ type: 'text', text: formatCodexHistoryText(block.text, role) })
        else {
          const reference =
            typeof block.file_id === 'string'
              ? block.file_id
              : typeof block.image_url === 'string' && !block.image_url.startsWith('data:')
                ? block.image_url
                : ''
          parts.push({
            type: 'text',
            text: '[Historical reference: ' + String(block.type ?? 'unknown') + '] ' + reference
          })
          diagnose('unsupported_content', line)
          result.downgradedParts++
        }
      }
    } else if (item.type === 'reasoning') {
      role = 'assistant'
      const content = Array.isArray(item.content) && item.content.length ? item.content : item.summary
      if (Array.isArray(content))
        for (const block of content)
          if (block && typeof block.text === 'string') parts.push({ type: 'reasoning', text: block.text })
      diagnose('reasoning_compatibility', line)
    } else if (
      [
        'function_call',
        'function_call_output',
        'custom_tool_call',
        'custom_tool_call_output',
        'local_shell_call',
        'web_search_call'
      ].includes(String(item.type))
    ) {
      parts.push({ type: 'text', text: formatCodexTool(item) })
      result.downgradedParts++
    } else {
      diagnose('unsupported_record', line)
      result.skippedRecords++
      continue
    }
    if (!result.title && role === 'user') {
      result.title = parts
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 255)
    }
    if (!parts.length) {
      result.skippedRecords++
      continue
    }
    const id = typeof item.id === 'string' ? item.id : 'line:' + line
    if (ids.has(id)) {
      diagnose('duplicate_message_id', line, 'error')
      continue
    }
    ids.add(id)
    let timestamp = row.timestamp ? Date.parse(row.timestamp) : NaN
    const inferredTimestamp = !Number.isFinite(timestamp)
    if (inferredTimestamp) {
      if (lastTime === undefined) {
        diagnose('missing_time', line, 'error')
        continue
      }
      timestamp = lastTime
      diagnose('inferred_time', line)
    }
    if (lastTime !== undefined && timestamp < lastTime) diagnose('timestamp_order', line, 'error')
    lastTime = timestamp
    result.messages.push({
      role,
      data: { parts },
      status: item.status === 'incomplete' ? 'paused' : 'success',
      timestamp,
      provenance: {
        source: 'codex',
        originalMessageId: id,
        isSetup: item.type === 'message' && role === 'system' ? true : undefined,
        sourceOrder: line - 1,
        originalTimestamp: row.timestamp,
        inferredTimestamp
      },
      messageSnapshot:
        role === 'assistant' && model
          ? {
              id: result.originalSessionId,
              name: result.title,
              model: { id: model, name: model, provider: meta.data.model_provider ?? 'openai' }
            }
          : null
    })
  }
  if (!result.title)
    result.title =
      'Codex · ' + (rows.find((entry) => entry.row.timestamp)?.row.timestamp?.slice(0, 10) ?? result.originalSessionId)
  if (directories.size > 1) diagnose('directory_required', undefined, 'error')
  if (!result.messages.length) diagnose('empty_session', undefined, 'error')
  const source = z.object({ subagent: z.object({ other: z.literal('guardian') }) }).safeParse(meta.data.source)
  if (
    meta.data.cli_version === '0.164.0-alpha.11.1' &&
    source.success &&
    !result.diagnostics.some(
      (d) =>
        (d.severity === 'error' && d.code !== 'empty_session') ||
        d.code === 'invalid_json' ||
        d.code === 'invalid_record'
    )
  )
    result.filteredReason = 'codex_guardian_review'
  if (Buffer.byteLength(JSON.stringify(result)) > IMPORT_LIMITS.session) throw new Error('session_limit')
  return result
}
