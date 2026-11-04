import * as z from 'zod'

import { formatClaudeHistoryText, formatClaudeTool, isClaudeLocalCommand } from '@data/services/importedHistoryText'
import type { MessageData } from '@shared/data/types/message'
import type { ImportDiagnostic } from '@shared/ipc/schemas/conversationImport'

import { discoverJsonl, readJsonl } from './files'
import { IMPORT_LIMITS, type HistorySourceAdapter, type NormalizedSession } from './types'

const RecordSchema = z
  .object({
    type: z.string(),
    uuid: z.string().optional(),
    parentUuid: z.string().nullable().optional(),
    sessionId: z.string().optional(),
    agentId: z.string().optional(),
    timestamp: z.string().optional(),
    cwd: z.string().optional(),
    version: z.string().optional(),
    customTitle: z.string().optional(),
    summary: z.string().optional(),
    isSidechain: z.boolean().optional(),
    message: z
      .object({
        role: z.string().optional(),
        content: z.union([z.string(), z.array(z.record(z.string(), z.unknown()))]),
        model: z.string().optional(),
        stop_reason: z.string().nullable().optional()
      })
      .optional()
  })
  .passthrough()
type RecordEntry = z.infer<typeof RecordSchema> & { line: number }
const metadata = new Set([
  'summary',
  'custom-title',
  'tag',
  'file-history-snapshot',
  'queue-operation',
  'progress',
  'last-prompt',
  'mode',
  'permission-mode'
])

// Only versioned local-command records are evidence of setup rather than a task.
function userTask(record: RecordEntry): 'task' | 'generated' | 'unknown' {
  if (record.type !== 'user') return 'generated'
  if (!record.message) return 'unknown'
  if (record.isMeta === true) return 'generated'
  const content = record.message.content
  const blocks = typeof content === 'string' ? [{ type: 'text', text: content }] : content
  let unknown = false
  for (const block of blocks) {
    if (block.type === 'image' || block.type === 'document') return 'task'
    if (block.type === 'tool_result') continue
    if (block.type !== 'text' || typeof block.text !== 'string') {
      unknown = true
      continue
    }
    const text = block.text.trim()
    if (!text) continue
    if (/^<(local-command-caveat|local-command-stdout|local-command-stderr)>[\s\S]*<\/\1>$/.test(text)) continue
    const command =
      /^<command-name>\/(model|exit|recap)<\/command-name>\s*<command-message>[\s\S]*?<\/command-message>\s*<command-args>[\s\S]*?<\/command-args>$/.test(
        text
      )
    if (command) continue
    if (isClaudeLocalCommand(text)) unknown = true
    else return 'task'
  }
  return unknown ? 'unknown' : 'generated'
}

function completeAncestry(records: RecordEntry[], nodes: Map<string, RecordEntry>, signal: AbortSignal) {
  const complete = new Set<string>()
  for (const record of records) {
    signal.throwIfAborted()
    if (record.message && (!record.uuid || record.parentUuid === undefined)) return false
    const visiting = new Set<string>()
    let cursor: RecordEntry | undefined = record
    while (cursor?.uuid && !complete.has(cursor.uuid)) {
      if (visiting.has(cursor.uuid)) return false
      visiting.add(cursor.uuid)
      if (!cursor.parentUuid) break
      cursor = nodes.get(cursor.parentUuid)
      if (!cursor) return false
    }
    for (const id of visiting) complete.add(id)
  }
  return true
}

export const claudeCodeAdapter: HistorySourceAdapter = {
  source: 'claude-code',
  async *discover(root, signal) {
    for await (const file of discoverJsonl(root, signal)) {
      let title: string | undefined
      let filteredReason: NormalizedSession['filteredReason']
      try {
        const session = await claudeCodeAdapter.read({ path: file }, signal)
        title = session.title
        filteredReason = session.filteredReason
      } catch {
        signal.throwIfAborted()
      }
      yield { path: file, title, filteredReason }
    }
  },
  async read(ref, signal, branchId) {
    const file = ref.path
    const input = await readJsonl(file, signal)
    const diagnostics: ImportDiagnostic[] = []
    const diagnose = (code: string, line?: number, severity: 'warning' | 'error' = 'warning') =>
      diagnostics.push({ code, path: file, line, severity })
    let unreadableRecords = 0
    const records: RecordEntry[] = []
    for (const { text, line } of input.lines) {
      signal.throwIfAborted()
      if (!text.trim()) continue
      try {
        const parsed = RecordSchema.safeParse(JSON.parse(text))
        if (parsed.success) records.push({ ...parsed.data, line })
        else {
          diagnose('invalid_record', line)
          unreadableRecords++
        }
      } catch {
        diagnose('invalid_json', line)
        unreadableRecords++
      }
    }
    const ids = new Set(records.flatMap((r) => (r.sessionId ? [r.sessionId] : [])))
    const agents = new Set(records.flatMap((r) => (r.agentId ? [r.agentId] : [])))
    if (ids.size !== 1 || agents.size > 1) diagnose('unstable_identity', undefined, 'error')
    const originalSessionId = [...ids][0] ?? ''
    const versions = [...new Set(records.flatMap((r) => (r.version ? [r.version] : [])))]
    // The raw reader requires the versioned 2.x UUID/parent transcript layout.
    if (!versions.length || versions.some((version) => !/^2\.1\.\d+$/.test(version)))
      diagnose('unsupported_version', undefined, 'error')
    const nodes = new Map<string, RecordEntry>()
    for (const record of records) {
      if (!record.uuid) continue
      if (nodes.has(record.uuid)) diagnose('duplicate_message_id', record.line, 'error')
      nodes.set(record.uuid, record)
    }
    const messages = records.filter((r) => ['user', 'assistant', 'system'].includes(r.type) && r.message)
    const parentIds = new Set(records.flatMap((r) => (r.parentUuid ? [r.parentUuid] : [])))
    let branches = messages.filter((r) => r.uuid && !parentIds.has(r.uuid)).map((r) => r.uuid!)
    // A metadata node can be the leaf; resolve it to its nearest message ancestor.
    for (const record of records.filter((r) => r.uuid && !parentIds.has(r.uuid) && !r.message)) {
      let cursor: RecordEntry | undefined = record
      const seen = new Set<string>()
      while (cursor?.uuid && !seen.has(cursor.uuid)) {
        seen.add(cursor.uuid)
        if (cursor.message) {
          branches.push(cursor.uuid)
          break
        }
        cursor = cursor.parentUuid ? nodes.get(cursor.parentUuid) : undefined
      }
    }
    branches = [...new Set(branches)]
    const selectedBranchId = branchId ?? (branches.length === 1 ? branches[0] : undefined)
    if (!selectedBranchId || !branches.includes(selectedBranchId)) diagnose('branch_required', undefined, 'error')
    const selected: RecordEntry[] = []
    const seen = new Set<string>()
    let current = selectedBranchId ? nodes.get(selectedBranchId) : undefined
    while (current?.uuid) {
      if (seen.has(current.uuid)) {
        diagnose('broken_parent_chain', current.line, 'error')
        break
      }
      seen.add(current.uuid)
      if (current.message) selected.unshift(current)
      if (!current.parentUuid) break
      const parent = nodes.get(current.parentUuid)
      if (!parent) {
        diagnose('broken_parent_chain', current.line, 'error')
        break
      }
      current = parent
    }
    const directories = [...new Set(selected.flatMap((r) => (r.cwd ? [r.cwd] : [])))]
    if (directories.length > 1) diagnose('directory_required', undefined, 'error')
    const firstUser = records.find(
      (record) =>
        record.type === 'user' &&
        record.isMeta !== true &&
        record.message &&
        (typeof record.message.content === 'string'
          ? !isClaudeLocalCommand(record.message.content) && record.message.content.trim()
          : record.message.content.some(
              (block) =>
                block.type === 'text' &&
                typeof block.text === 'string' &&
                block.text.trim() &&
                !isClaudeLocalCommand(block.text)
            ))
    )
    const firstText =
      typeof firstUser?.message?.content === 'string'
        ? firstUser.message.content
        : firstUser?.message?.content
            .filter((block) => block.type === 'text')
            .map((block) => block.text)
            .join(' ')
    const sourceTitle =
      records.findLast((record) => record.customTitle?.trim())?.customTitle ??
      records.findLast((record) => record.summary?.trim())?.summary
    const title = (
      sourceTitle?.trim() ||
      firstText?.replace(/\s+/g, ' ').trim() ||
      'Claude Code · ' + (records.find((record) => record.timestamp)?.timestamp?.slice(0, 10) ?? originalSessionId)
    ).slice(0, 255)
    const result: NormalizedSession = {
      source: 'claude-code',
      originalSessionId: agents.size === 1 ? originalSessionId + ':subagent:' + [...agents][0] : originalSessionId,
      sourcePaths: [file],
      sourceVersion: versions.join(', '),
      title,
      workingDirectory: directories.length === 1 ? directories[0] : undefined,
      messages: [],
      branches,
      selectedBranchId,
      sourceFingerprint: input.fingerprint,
      inputBytes: input.bytes,
      diagnostics,
      skippedRecords: unreadableRecords,
      downgradedParts: 0
    }
    const classifications = records.map(userTask)
    const classifiable =
      unreadableRecords === 0 &&
      versions.length > 0 &&
      versions.every((version) => ['2.1.207', '2.1.211', '2.1.284'].includes(version)) &&
      !diagnostics.some((d) => ['unstable_identity', 'duplicate_message_id'].includes(d.code)) &&
      records.every(
        (record) =>
          metadata.has(record.type) ||
          (record.type === 'system' && record.subtype === 'local_command' && typeof record.content === 'string') ||
          (['user', 'assistant', 'system'].includes(record.type) && record.message)
      ) &&
      completeAncestry(records, nodes, signal) &&
      !classifications.includes('unknown')
    if (classifiable && !classifications.includes('task')) result.filteredReason = 'claude_no_user_task'
    else if (classifiable && selectedBranchId && !selected.some((record) => userTask(record) === 'task'))
      diagnose('branch_required', undefined, 'error')
    const calls = new Map<string, string>()
    let lastValid: number | undefined
    for (const [order, record] of selected.entries()) {
      if (typeof record.message?.content === 'string' && /^\s*<local-command-caveat>/.test(record.message.content)) {
        result.skippedRecords++
        continue
      }
      let timestamp = record.timestamp ? Date.parse(record.timestamp) : NaN
      const inferredTimestamp = !Number.isFinite(timestamp)
      if (inferredTimestamp) {
        if (lastValid === undefined) {
          diagnose('missing_time', record.line, 'error')
          continue
        }
        timestamp = lastValid
        diagnose('inferred_time', record.line)
      } else {
        lastValid = timestamp
      }
      const parts: MessageData['parts'] = []
      const content = record.message!.content
      const blocks = typeof content === 'string' ? [{ type: 'text', text: content }] : content
      let role: 'user' | 'assistant' | 'system' =
        record.type === 'assistant' ? 'assistant' : record.type === 'system' ? 'system' : 'user'
      if (typeof content === 'string' && isClaudeLocalCommand(content)) role = 'system'
      if (blocks.length && blocks.every((b) => b.type === 'tool_result')) role = 'system'
      else if (blocks.some((b) => b.type === 'tool_result')) diagnose('unsupported_record', record.line, 'error')
      for (const block of blocks) {
        if (block.type === 'text' && typeof block.text === 'string')
          parts.push({ type: 'text', text: formatClaudeHistoryText(block.text) })
        else if (block.type === 'thinking' && typeof block.thinking === 'string') {
          parts.push({ type: 'reasoning', text: formatClaudeHistoryText(block.thinking) })
          diagnose('reasoning_compatibility', record.line)
        } else if (block.type === 'tool_use') {
          if (typeof block.id === 'string' && typeof block.name === 'string') calls.set(block.id, block.name)
          parts.push({ type: 'text', text: formatClaudeTool(block) })
          result.downgradedParts++
        } else if (block.type === 'tool_result') {
          const name = typeof block.tool_use_id === 'string' ? calls.get(block.tool_use_id) : undefined
          if (!name) diagnose('unmatched_tool_result', record.line)
          parts.push({
            type: 'text',
            text: formatClaudeTool(block, name)
          })
          result.downgradedParts++
        } else {
          // Keep references inert and never embed base64 attachments in historical text.
          const reference = typeof block.path === 'string' ? block.path : typeof block.url === 'string' ? block.url : ''
          parts.push({
            type: 'text',
            text: '[Historical reference: ' + String(block.type ?? 'unknown') + '] ' + reference
          })
          diagnose('unsupported_content', record.line)
          result.downgradedParts++
        }
      }
      if (!parts.length) {
        result.skippedRecords++
        continue
      }
      const model = record.message?.model
      result.messages.push({
        role,
        data: { parts },
        status:
          record.isApiErrorMessage === true ? 'error' : record.message?.stop_reason === null ? 'paused' : 'success',
        timestamp,
        provenance: {
          source: 'claude-code',
          originalMessageId: record.uuid!,
          sourceOrder: order,
          originalTimestamp: record.timestamp,
          inferredTimestamp
        },
        messageSnapshot: model
          ? { id: originalSessionId, name: result.title, model: { id: model, name: model, provider: 'anthropic' } }
          : null
      })
    }
    for (const record of records) {
      if (metadata.has(record.type)) continue
      if (!['user', 'assistant', 'system'].includes(record.type) || !record.message) {
        diagnose('unsupported_record', record.line)
        result.skippedRecords++
      } else if (!record.uuid || !seen.has(record.uuid)) {
        diagnose('unselected_branch', record.line)
        result.skippedRecords++
      }
    }
    if (!result.messages.length) diagnose('empty_session', undefined, 'error')
    for (let i = 1; i < result.messages.length; i++)
      if (result.messages[i].timestamp < result.messages[i - 1].timestamp) {
        diagnose('timestamp_order', undefined, 'error')
        break
      }
    if (Buffer.byteLength(JSON.stringify(result)) > IMPORT_LIMITS.session) throw new Error('session_limit')
    return result
  }
}
