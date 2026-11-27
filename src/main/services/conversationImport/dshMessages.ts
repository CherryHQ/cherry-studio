import path from 'node:path'

import { formatClaudeTool } from '@data/services/importedHistoryText'

import { readDshArchive } from './dshArchive'
import { IMPORT_LIMITS, type NormalizedMessage, type NormalizedSession } from './types'

type Fields = Record<string, unknown>
type Part = { type: 'text' | 'reasoning'; text: string }
type PendingStream = {
  step: string
  time: number
  line: number
  inferred: boolean
  terminal?: boolean
  fragments: Map<number, Fields>
}

function fields(value: unknown): Fields {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Fields) : {}
}

function string(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(new Date(value).getTime())
}

const setup = new Set([
  'turn/start',
  'turn/end',
  'step/start',
  'step/end',
  'session/end-seed',
  'system/message',
  'developer/message',
  'permission/preset',
  'sandbox/mode',
  'approval/policy',
  'approval/asked',
  'approval/decided',
  'agent/inbox/spliced',
  'request/header',
  'request/context',
  'session/title-llm-request',
  'web/deepseek-search-llm-request',
  'model/selection',
  'llm/retry',
  'llm/retry-started',
  'session-log-deepseek/delivery-accepted',
  'job/registered',
  'job/settled',
  'command/run',
  'command/done'
])
const generatedUsers = new Set([
  'compact-checkpoint',
  'runtime-context',
  'plugin',
  'skill-catalog',
  'time-context',
  'model-selection',
  'tool-jobs'
])

function toolInput(value: unknown) {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function blockText(value: unknown): string {
  if (typeof value === 'string') return value
  const block = fields(value)
  if (block.type === 'file' || block.type === 'image') {
    const attachment = fields(block.attachment)
    const reference = string(attachment.name) || string(attachment.attachmentId)
    return reference ? '[Historical attachment: ' + reference + ']' : '[Historical attachment]'
  }
  return string(block.text)
}

function readFragment(fragments: Map<number, Fields>, kind: string, data: Fields) {
  const chunk = kind === 'assistant/chunk' || kind === 'chunk' ? fields(data.chunk) : data
  const index = typeof chunk.index === 'number' ? chunk.index : 0
  const type = string(chunk.type)
  if (type === 'block-end') fragments.set(index, fields(chunk.block))
  else if (
    type === 'text-delta' ||
    type === 'reasoning-delta' ||
    kind === 'reasoning-chunks' ||
    kind === 'text-chunks'
  ) {
    const delta = Array.isArray(chunk.texts)
      ? chunk.texts.filter((t) => typeof t === 'string').join('')
      : string(chunk.text)
    fragments.set(index, {
      type: (type || kind).startsWith('reasoning') ? 'reasoning' : 'text',
      text: string(fragments.get(index)?.text) + delta
    })
  } else if (type === 'tool-call-delta' || kind === 'tool-call-chunks') {
    const prior = fragments.get(index)
    fragments.set(index, {
      type: 'tool-call',
      id: string(chunk.id) || prior?.id,
      name: string(chunk.name) || prior?.name,
      arguments:
        string(prior?.arguments) + (Array.isArray(chunk.args) ? chunk.args.join('') : string(chunk.argumentsDelta))
    })
  }
}

export async function readDshSession(file: string, signal: AbortSignal): Promise<NormalizedSession> {
  const session: NormalizedSession = {
    source: 'dsh',
    originalSessionId: '',
    title: '',
    sourcePaths: [file],
    branches: [],
    messages: [],
    sourceFingerprint: '',
    inputBytes: 0,
    diagnostics: [],
    skippedRecords: 0,
    downgradedParts: 0
  }
  let createdAt = 0
  let time = 0
  let inferred = true
  let line = 0
  let firstUser = ''
  let setupOnly = true
  const ids = new Map<string, NormalizedMessage>()
  const calls = new Map<string, string>()
  const attempts: PendingStream[] = []
  const recoveredCounts = new Map<string, number>()
  let stream: PendingStream | undefined
  const warn = (code: string, severity: 'warning' | 'error' = 'warning') =>
    session.diagnostics.push({ code, line, path: file, severity })

  function append(
    role: NormalizedMessage['role'],
    parts: Part[],
    id: string,
    status: NormalizedMessage['status'] = 'success',
    source?: Fields
  ) {
    if (!parts.length) return
    const message: NormalizedMessage = {
      role,
      data: { parts },
      status,
      timestamp: time,
      provenance: {
        source: 'dsh',
        sourceOrder: session.messages.length,
        originalMessageId: id,
        originalTimestamp: inferred ? undefined : new Date(time).toISOString(),
        inferredTimestamp: inferred
      },
      messageSnapshot:
        typeof source?.model === 'string'
          ? {
              id: session.originalSessionId,
              name: session.title,
              model: { id: source.model, name: source.model, provider: string(source.provider) || 'dsh' }
            }
          : null
    }
    const prior = ids.get(id)
    if (prior) {
      if (prior.role !== role || prior.status !== status || JSON.stringify(prior.data) !== JSON.stringify(message.data))
        warn('identity_conflict', 'error')
      return
    }
    ids.set(id, message)
    session.messages.push(message)
    if (role === 'user' && !firstUser) firstUser = parts[0].text.trim().slice(0, 255)
  }

  function call(
    id: string,
    name: string,
    args: unknown,
    status: NormalizedMessage['status'] = 'success',
    fallback = 'line:' + line
  ) {
    if (status === 'paused' && id && calls.has(id)) return
    const key = 'call:' + (id || fallback)
    const prior = ids.get(key)
    const text = formatClaudeTool({ type: 'tool_use', name, input: toolInput(args) }) + (id ? '\n\nCall ID: ' + id : '')
    if (prior?.status === 'paused' && status === 'success') {
      prior.data.parts = [{ type: 'text', text }]
      prior.status = status
    } else append('system', [{ type: 'text', text }], key, status)
    if (id) calls.set(id, name)
  }

  function message(
    role: NormalizedMessage['role'],
    msg: Fields,
    fallback: string,
    status: NormalizedMessage['status'] = 'success'
  ) {
    const id = string(msg.id) || fallback
    const parts: Part[] = []
    let segment = 0
    const flush = () => {
      if (!parts.length) return
      append(role, parts.splice(0), segment ? id + ':' + segment : id, status, fields(msg.source))
      segment++
    }
    const blocks = Array.isArray(msg.content) ? msg.content : [msg.content]
    for (const [index, value] of blocks.entries()) {
      const block = fields(value)
      if (block.type === 'tool-call') {
        flush()
        call(string(block.id), string(block.name), block.arguments, status, id + ':block:' + index)
      } else {
        const text = blockText(value)
        if (text) parts.push({ type: block.type === 'reasoning' ? 'reasoning' : 'text', text })
        if (
          !text ||
          (typeof value !== 'string' && !['reasoning', 'text', 'file', 'image'].includes(string(block.type)))
        ) {
          session.downgradedParts++
          warn('unsupported_content')
        }
      }
    }
    flush()
  }

  function finishAttempt() {
    if (stream?.fragments.size) attempts.push(stream)
    stream = undefined
  }

  function flushStreams() {
    finishAttempt()
    const saved = { time, line, inferred }
    for (const attempt of attempts) {
      time = attempt.time
      line = attempt.line
      inferred = attempt.inferred
      const content = [...attempt.fragments.entries()].sort(([a], [b]) => a - b).map(([, block]) => block)
      // Migrations can move archive lines. Distinguish retries even when their first chunks share a timestamp.
      const key = 'stream:' + attempt.step + ':' + time
      const occurrence = (recoveredCounts.get(key) ?? 0) + 1
      recoveredCounts.set(key, occurrence)
      message('assistant', { content }, key + ':' + occurrence, 'paused')
      session.downgradedParts++
      warn('incomplete_message')
    }
    time = saved.time
    line = saved.line
    inferred = saved.inferred
    attempts.length = 0
  }

  function parse(text: string, number: number) {
    if (!text.trim()) return
    line = number
    let row: Fields
    try {
      row = fields(JSON.parse(text))
    } catch {
      session.skippedRecords++
      warn('invalid_json', number === 1 ? 'error' : 'warning')
      return
    }
    const kind = string(row.type)
    if (number === 1) {
      if (kind !== 'session' || !string(row.id)) throw new Error('unstable_identity')
      session.originalSessionId = string(row.id)
      session.sourceVersion = String(row.version)
      if (![0, 3, 4].includes(Number(row.version)) || typeof row.version !== 'number')
        warn('unsupported_history_layout', 'error')
      session.workingDirectory = string(row.cwd) || undefined
      createdAt = isTimestamp(row.createdAt) ? row.createdAt : 0
      return
    }
    if (kind === 'session') {
      warn('identity_conflict', 'error')
      return
    }
    const data = fields(row.data)
    const timestamp = row.time ?? row.time0
    inferred = !isTimestamp(timestamp)
    time = inferred ? (session.messages.at(-1)?.timestamp ?? createdAt) : Number(timestamp)
    const step = String(data.turn) + '/' + String(data.step)
    const pending = stream ?? attempts.at(-1)
    if (
      pending &&
      ((data.turn !== undefined && step !== pending.step) ||
        ['step/end', 'turn/end', 'session/end-seed', 'user/message', 'tool/call', 'tool/result'].includes(kind))
    )
      flushStreams()
    if (kind === 'llm/retry' || kind === 'llm/retry-started') finishAttempt()
    if (kind === 'assistant/attempt') {
      const fragments = new Map<number, Fields>()
      const records = Array.isArray(data.stream) ? data.stream : []
      for (const entry of records) {
        const record = fields(entry)
        readFragment(fragments, string(record.type), record)
      }
      // The embedded stream mirrors this attempt's live chunks. A later final message supersedes both.
      if (fragments.size) {
        const first = fields(records[0])
        const start = first.time0 ?? first.time
        const origin = isTimestamp(start) ? { time: start, inferred: false } : (stream ?? { time, inferred })
        stream = { ...origin, step, line, fragments }
      }
      if (stream?.fragments.size) setupOnly = false
      else session.skippedRecords++
      finishAttempt()
      return
    }
    if (kind === 'assistant/chunk' || ['reasoning-chunks', 'text-chunks', 'tool-call-chunks'].includes(kind)) {
      setupOnly = false
      if (stream?.terminal) finishAttempt()
      stream ??= { step, time, line, inferred, fragments: new Map() }
      readFragment(stream.fragments, kind, data)
      stream.terminal = kind === 'assistant/chunk' && fields(data.chunk).type === 'finish'
      return
    }
    if (kind === 'session/title') {
      session.title = string(data.title).trim() || session.title
      return
    }
    if (setup.has(kind)) {
      session.skippedRecords++
      return
    }
    if (kind === 'user/message' && generatedUsers.has(string(fields(data.source).kind))) {
      session.skippedRecords++
      return
    }
    setupOnly = false
    const legacy = session.sourceVersion === '0'
    const fallbackId =
      legacy && Number.isSafeInteger(row.seq)
        ? `legacy-message:${session.originalSessionId}:${row.seq}`
        : 'line:' + line
    const msg: Fields =
      legacy && data.message === undefined && data.content !== undefined
        ? { ...data, source: data.provenance ?? data.source }
        : fields(data.message)
    if (kind === 'assistant/message') {
      const blocks = Array.isArray(msg.content) ? msg.content : [msg.content]
      if (blocks.some((part) => blockText(part) || fields(part).type === 'tool-call')) {
        attempts.length = 0
        stream = undefined
      } else flushStreams()
      message('assistant', msg, fallbackId, data.interrupted === true ? 'paused' : 'success')
    } else if (kind === 'user/message') {
      message(fields(data.source).kind === 'goal' ? 'system' : 'user', data, fallbackId)
    } else if (kind === 'tool/call') {
      call(string(data.callId), string(data.name), data.arguments)
    } else if (kind === 'tool/result') {
      const blocks = Array.isArray(msg.content) ? msg.content : [msg.content]
      const nested = blocks.map(fields).filter((b) => b.type === 'tool-result')
      for (const result of nested.length ? nested : [msg]) {
        const id = string(result.toolCallId) || string(fields(msg.source).callId) || string(msg.callId)
        const content = Array.isArray(result.content) ? result.content : [result.content]
        const output = content.map(blockText).filter(Boolean).join('\n\n')
        if (!output && content.length) {
          session.downgradedParts++
          warn('unsupported_tool_output')
        }
        const text = formatClaudeTool(
          { type: 'tool_result', content: output + (id ? '\n\nCall ID: ' + id : '') },
          calls.get(id)
        )
        append(
          'system',
          [{ type: 'text', text }],
          'result:' + (id || string(msg.id) || line),
          result.isError === true ? 'error' : 'success'
        )
      }
    } else {
      const value = data.content ?? msg.content ?? data.text ?? row.content ?? row.text
      const readable = (Array.isArray(value) ? value : [value]).map(blockText).filter(Boolean).join('\n')
      if (readable) {
        append(
          'system',
          [{ type: 'text', text: '[Historical ' + (kind || 'record') + ']\n' + readable }],
          'line:' + line
        )
        session.downgradedParts++
      } else session.skippedRecords++
      warn('unsupported_record')
    }
  }

  try {
    const input = await readDshArchive(file, signal, parse)
    session.sourceFingerprint = input.fingerprint
    session.inputBytes = input.bytes
    flushStreams()
  } catch (error) {
    signal.throwIfAborted()
    const code =
      error instanceof Error &&
      ['source_changed', 'session_limit', 'line_limit', 'unstable_identity'].includes(error.message)
        ? error.message
        : 'incomplete_source'
    warn(code, 'error')
  }
  if (!session.originalSessionId) warn('unstable_identity', 'error')
  session.title ||=
    firstUser ||
    (createdAt ? 'DSH · ' + new Date(createdAt).toISOString().slice(0, 10) : path.basename(path.dirname(file)))
  for (const message of session.messages) {
    if (message.messageSnapshot) message.messageSnapshot.name = session.title
  }
  if (!session.messages.length) {
    if (setupOnly && !session.diagnostics.length) session.filteredReason = 'dsh_settings_only'
    else warn('empty_session', 'error')
  }
  if (Buffer.byteLength(JSON.stringify(session)) > IMPORT_LIMITS.session) {
    session.messages = []
    session.filteredReason = undefined
    session.diagnostics = [{ code: 'session_limit', severity: 'error', path: file }]
  }
  return session
}
