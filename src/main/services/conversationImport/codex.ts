import { createHash } from 'node:crypto'
import path from 'node:path'

import * as z from 'zod'

import { formatCodexHistoryText, formatCodexTool, isCodexContextText } from '@data/services/importedCodexText'
import type { MessageData } from '@shared/data/types/message'

import { discoverJsonl, readJsonl } from './files'
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
    model_provider: z.string().optional()
  })
  .passthrough()

async function indexInput(file: string, signal: AbortSignal) {
  try {
    return await readJsonl(file, signal)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return { lines: [], fingerprint: 'absent', bytes: 0 }
  }
}

export const codexAdapter: HistorySourceAdapter = {
  source: 'codex',
  async *discover(root, signal) {
    const indexPath = path.join(root, 'session_index.jsonl')
    const index = await indexInput(indexPath, signal)
    const titles = new Map<string, string>()
    for (const row of index.lines) {
      try {
        const entry = JSON.parse(row.text)
        if (typeof entry.id === 'string' && typeof entry.thread_name === 'string' && entry.thread_name.trim())
          titles.set(entry.id, entry.thread_name)
      } catch {
        /* Preview reports malformed index records. */
      }
    }
    const sessions = new Map<string, SessionRef & { sourcePaths: string[]; originalSessionId: string }>()
    let scanned = 0
    for await (const file of discoverJsonl(root, signal)) {
      if (++scanned > 10_000) throw new Error('scan_limit')
      if (!path.basename(file).startsWith('rollout-')) continue
      let id = file
      try {
        const input = await readJsonl(file, signal)
        const first = input.lines.find((line) => line.text.trim())
        const row = first && Row.safeParse(JSON.parse(first.text))
        const meta = row && row.success && row.data.type === 'session_meta' && Meta.safeParse(row.data.payload)
        if (meta && meta.success) id = meta.data.id
      } catch {
        signal.throwIfAborted()
      }
      const existing = sessions.get(id)
      if (existing) existing.sourcePaths.push(file)
      else
        sessions.set(id, { path: file, sourcePaths: [indexPath, file], originalSessionId: id, title: titles.get(id) })
      if (sessions.size > 10_000) throw new Error('scan_limit')
    }
    for (const ref of sessions.values()) {
      try {
        const session = await codexAdapter.read(ref, signal)
        ref.title = session.title
        ref.filteredReason = session.filteredReason
      } catch {
        signal.throwIfAborted()
      }
      yield ref
    }
  },
  async read(ref, signal) {
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
    const index = indexPath ? await indexInput(indexPath, signal) : undefined
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
        diagnose('invalid_json', entry.line)
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
    for (const entry of index?.lines ?? []) {
      try {
        const title = JSON.parse(entry.text)
        if (title.id === result.originalSessionId && typeof title.thread_name === 'string' && title.thread_name.trim())
          result.title = title.thread_name
      } catch {
        result.diagnostics.push({ code: 'invalid_json', path: indexPath!, line: entry.line, severity: 'warning' })
      }
    }
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
            parts.push({ type: 'text', text: formatCodexHistoryText(block.text) })
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
        'Codex · ' +
        (rows.find((entry) => entry.row.timestamp)?.row.timestamp?.slice(0, 10) ?? result.originalSessionId)
    if (directories.size > 1) diagnose('directory_required', undefined, 'error')
    if (!result.messages.length) diagnose('empty_session', undefined, 'error')
    const source = z.object({ subagent: z.object({ other: z.literal('guardian') }) }).safeParse(meta.data.source)
    if (
      meta.data.cli_version === '0.164.0-alpha.11.1' &&
      source.success &&
      !result.diagnostics.some((d) =>
        [
          'invalid_json',
          'invalid_record',
          'unsupported_version',
          'unsupported_history_layout',
          'unsupported_history_order'
        ].includes(d.code)
      )
    )
      result.filteredReason = 'codex_guardian_review'
    if (Buffer.byteLength(JSON.stringify(result)) > IMPORT_LIMITS.session) throw new Error('session_limit')
    return result
  }
}
