import type { AssistantMessage, JsonValue, Usage } from '@earendil-works/pi-ai'
import type { SessionEntry } from '@earendil-works/pi-coding-agent'
import { type AssistantModelMessage, modelMessageSchema } from 'ai'

import { AI_SDK_API } from './aiSdkProvider'
import { toPiAssistantContent, toPiToolResult, toPiUserContent } from './modelMessages'
import {
  TOOL_LOADOUT_STATE,
  type TranscriptEntry,
  TranscriptError,
  type TranscriptMessageEntry,
  type TranscriptStopReason,
  type TranscriptUsage
} from './transcript'

/** The model a session is rebuilt for: its host key and its Pi identity. */
export interface TranscriptModel {
  key: string
  provider: string
  id: string
}

export interface RebuiltTranscript {
  /** Pi session entries in transcript order, keeping the host's ids and timestamps. */
  entries: SessionEntry[]
  /** Tools activated beyond the session's base tools, from the last tool-loadout state entry. */
  activatedTools: string[]
}

// Any api other than the bridge's marks a reply as another model's: Pi then replays no signatures.
const FOREIGN_API = 'transcript'
const STOP_REASONS = new Set<TranscriptStopReason>(['stop', 'length', 'toolUse', 'error', 'aborted'])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0

const invalid = (entryId: string | undefined, reason: string) =>
  new TranscriptError('invalid_entry', entryId, `Invalid transcript entry: ${reason}`)

function toPiUsage(usage: TranscriptUsage | undefined, entryId: string): Usage {
  const { input = 0, output = 0, cacheRead = 0, cacheWrite = 0, reasoning } = usage ?? {}
  if (![input, output, cacheRead, cacheWrite].every(isCount) || (reasoning !== undefined && !isCount(reasoning)))
    throw invalid(entryId, 'usage counts must be non-negative numbers')
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    ...(reasoning === undefined ? {} : { reasoning }),
    totalTokens: input + output + cacheRead + cacheWrite,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
  }
}

function toAssistantMessage(
  entry: TranscriptMessageEntry,
  message: AssistantModelMessage,
  model: TranscriptModel
): AssistantMessage {
  const stopReason = entry.stopReason ?? 'stop'
  if (!STOP_REASONS.has(stopReason)) throw invalid(entry.id, `unknown stop reason ${String(stopReason)}`)
  if (![entry.errorMessage, entry.responseId].every((value) => value === undefined || typeof value === 'string'))
    throw invalid(entry.id, 'errorMessage and responseId must be strings')
  const sameModel = entry.modelKey === model.key
  const foreign = entry.modelKey ?? 'unknown'
  return {
    role: 'assistant',
    content: toPiAssistantContent(message.content, entry.id),
    api: sameModel ? AI_SDK_API : FOREIGN_API,
    provider: sameModel ? model.provider : foreign,
    model: sameModel ? model.id : foreign,
    usage: toPiUsage(entry.usage, entry.id),
    stopReason,
    ...(entry.errorMessage === undefined ? {} : { errorMessage: entry.errorMessage }),
    ...(entry.responseId === undefined ? {} : { responseId: entry.responseId }),
    timestamp: entry.timestamp
  }
}

function toActivatedTools(data: unknown, entryId: string): string[] {
  const activated = isRecord(data) ? data.activated : undefined
  if (!Array.isArray(activated) || !activated.every((name) => typeof name === 'string'))
    throw invalid(entryId, `${TOOL_LOADOUT_STATE} needs an "activated" list of tool names`)
  return activated
}

/**
 * Validates a host transcript and converts it into Pi session entries, failing closed with a
 * {@link TranscriptError}. Assistant replies of `model.key` are stamped with the current Pi model
 * so their reasoning signatures replay; other models' replies get a foreign stamp.
 */
export function rebuildSessionEntries(
  transcript: readonly TranscriptEntry[],
  model: TranscriptModel
): RebuiltTranscript {
  const entries: SessionEntry[] = []
  const kinds = new Map<string, TranscriptEntry['kind']>()
  const toolCallIds = new Set<string>()
  let activatedTools: string[] = []
  let parentId: string | null = null

  for (const raw of transcript as readonly unknown[]) {
    if (!isRecord(raw) || typeof raw.id !== 'string' || raw.id === '')
      throw invalid(undefined, 'every entry needs a non-empty string id')
    const entry = raw as unknown as TranscriptEntry
    const { id } = entry
    if (typeof entry.timestamp !== 'number' || Number.isNaN(new Date(entry.timestamp).getTime()))
      throw invalid(id, 'timestamp must be a number of milliseconds within the Date range')
    if (kinds.has(id)) throw new TranscriptError('duplicate_id', id, 'Duplicate transcript entry id')
    const base = { id, parentId, timestamp: new Date(entry.timestamp).toISOString() }

    switch (entry.kind) {
      case 'message': {
        const { message, custom } = entry
        if (!modelMessageSchema.safeParse(message).success)
          throw invalid(id, 'a message entry needs an AI SDK ModelMessage')
        if (custom !== undefined) {
          if (message.role !== 'user' || !isRecord(custom) || typeof custom.type !== 'string')
            throw invalid(id, 'a custom message needs a user message and a type')
          entries.push({
            ...base,
            type: 'custom_message',
            customType: custom.type,
            content: toPiUserContent(message.content, id),
            display: custom.display === true,
            details: custom.details
          })
          break
        }
        switch (message.role) {
          case 'user':
            entries.push({
              ...base,
              type: 'message',
              message: { role: 'user', content: toPiUserContent(message.content, id), timestamp: entry.timestamp }
            })
            break
          case 'assistant': {
            const assistant = toAssistantMessage(entry, message, model)
            for (const block of assistant.content) if (block.type === 'toolCall') toolCallIds.add(block.id)
            entries.push({ ...base, type: 'message', message: assistant })
            break
          }
          case 'tool': {
            const result = toPiToolResult(message, id)
            if (!toolCallIds.has(result.toolCallId))
              throw new TranscriptError('orphan_tool_result', id, 'Tool result without an earlier matching tool call')
            entries.push({
              ...base,
              type: 'message',
              message: {
                role: 'toolResult',
                ...result,
                ...(entry.details === undefined ? {} : { details: entry.details as JsonValue }),
                timestamp: entry.timestamp
              }
            })
            break
          }
          default:
            throw invalid(id, `unsupported message role ${String((message as { role?: unknown }).role)}`)
        }
        break
      }
      case 'compaction':
        if (typeof entry.summary !== 'string' || !isCount(entry.tokensBefore))
          throw invalid(id, 'a compaction needs a summary and tokensBefore')
        if (typeof entry.firstKeptEntryId !== 'string') throw invalid(id, 'firstKeptEntryId must be a string')
        if (entry.firstKeptEntryId !== id && !kinds.has(entry.firstKeptEntryId))
          throw new TranscriptError(
            'compaction_boundary_missing',
            id,
            'Compaction keeps from an entry that is not before it'
          )
        entries.push({
          ...base,
          type: 'compaction',
          summary: entry.summary,
          firstKeptEntryId: entry.firstKeptEntryId,
          tokensBefore: entry.tokensBefore,
          ...(entry.details === undefined ? {} : { details: entry.details })
        })
        break
      case 'context-edit':
        if (entry.replacement !== null) throw invalid(id, 'context edits can only remove a message')
        if (typeof entry.targetId !== 'string') throw invalid(id, 'targetId must be a string')
        if (kinds.get(entry.targetId) !== 'message')
          throw new TranscriptError('edit_target_missing', id, 'Context edit targets no earlier message')
        entries.push({ ...base, type: 'context_edit', targetId: entry.targetId, replacement: null })
        break
      case 'state':
        if (typeof entry.type !== 'string') throw invalid(id, 'a state entry needs a type')
        if (entry.type === TOOL_LOADOUT_STATE) activatedTools = toActivatedTools(entry.data, id)
        entries.push({ ...base, type: 'custom', customType: entry.type, data: entry.data })
        break
      default:
        throw invalid(id, `unknown kind ${String((entry as { kind?: unknown }).kind)}`)
    }
    kinds.set(id, entry.kind)
    parentId = id
  }
  return { entries, activatedTools }
}
