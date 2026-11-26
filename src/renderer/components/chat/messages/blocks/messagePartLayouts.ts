import { getToolName, isToolUIPart } from 'ai'

import { getDisplayComposerTokens } from '@renderer/utils/message/composerTokens'
import { REPORT_ARTIFACTS_TOOL_NAME } from '@shared/ai/builtinTools'
import type { CherryMessagePart } from '@shared/data/types/message'
import { readCherryMeta } from '@shared/data/types/uiParts'

import { agentInlineResultPresentationRegistry } from '../tools/agent'
import { isChannelAuthQrPart } from '../tools/channelConfigTool'
import { isGeneratedImageResultPart } from '../tools/painting/generateImageTool'
import { isAskUserQuestionToolName } from '../tools/shared/agentToolTypes'

export interface PartEntry {
  part: CherryMessagePart
  index: number
  partId?: string
}

export interface ProcessLayoutItem {
  kind: 'process'
  key: string | number
  entries: readonly PartEntry[]
}

export interface InlinePartLayoutItem {
  kind: 'part'
  key: string | number
  entry: PartEntry
}

export type MessagePartLayoutItem = ProcessLayoutItem | InlinePartLayoutItem

export interface CompletedMessagePartLayout {
  items: readonly MessagePartLayoutItem[]
  reportEntries: readonly PartEntry[]
}

interface MessagePartLayoutOptions {
  keepIntermediateAssistantText?: boolean
}

const HIDDEN_PART_TYPES = new Set([
  'step-start',
  'source-url',
  'source-document',
  'data-citation',
  'data-agent-task-event',
  'data-knowledge-scope',
  'data-clear'
])

const ASSOCIATED_RESULT_PART_TYPES = new Set(['data-error', 'data-imported-status', 'file', 'data-video'])

export function isHiddenPart(part: CherryMessagePart): boolean {
  return HIDDEN_PART_TYPES.has(part.type)
}

function isIgnorableEmptyContentPart(part: CherryMessagePart): boolean {
  if (part.type === 'text') return isEmptyContentPart(part)
  if (part.type !== 'reasoning') return false
  return part.state !== 'streaming' && isEmptyContentPart(part)
}

function hasVisibleComposerToken(part: CherryMessagePart): boolean {
  if (part.type !== 'text') return false
  const text = part.text ?? ''
  const composer = readCherryMeta(part)?.composer
  if (!composer) return false

  return getDisplayComposerTokens(composer).some((token) => {
    if (!token.promptText) return true
    const offset = Math.max(0, Math.min(text.length, token.textOffset))
    return text.slice(offset, offset + token.promptText.length) === token.promptText
  })
}

function isEmptyContentPart(part: CherryMessagePart): boolean {
  // Narrow on `part.type` itself; an aliased copy would not discriminate the
  // union, which is what previously forced a `part as { text?: string }` cast.
  if (part.type !== 'text' && part.type !== 'reasoning') return false
  return !part.text?.trim() && !hasVisibleComposerToken(part)
}

function isEllipsisOnlyTextPart(part: CherryMessagePart): boolean {
  if (part.type !== 'text') return false
  return /^(?:\.{3}|…)$/.test(part.text?.trim() ?? '')
}

function findAdjacentMeaningfulPart(
  entries: readonly PartEntry[],
  position: number,
  direction: -1 | 1
): CherryMessagePart | undefined {
  for (let index = position + direction; index >= 0 && index < entries.length; index += direction) {
    const part = entries[index].part
    if (isHiddenPart(part) || isEmptyContentPart(part) || isEllipsisOnlyTextPart(part)) continue
    return part
  }
  return undefined
}

function isProcessContentPart(part: CherryMessagePart | undefined): boolean {
  return !!part && (isToolUIPart(part) || part.type === 'reasoning')
}

/**
 * Some providers emit a standalone ellipsis immediately before a tool call.
 * Treat it as a projection-only process marker while keeping the raw part.
 * During a live gap, hold a trailing candidate only when process content
 * already precedes it; terminal projection preserves a genuine final "...".
 */
function isProcessFillerText(
  entries: readonly PartEntry[],
  position: number,
  holdTrailingLiveCandidate: boolean
): boolean {
  if (!isEllipsisOnlyTextPart(entries[position].part)) return false

  const nextPart = findAdjacentMeaningfulPart(entries, position, 1)
  if (isProcessContentPart(nextPart)) return true
  if (nextPart || !holdTrailingLiveCandidate) return false

  return isProcessContentPart(findAdjacentMeaningfulPart(entries, position, -1))
}

function getPartToolName(part: CherryMessagePart): string {
  return isToolUIPart(part) ? getToolName(part).trim() : ''
}

function isReportToolPart(part: CherryMessagePart): boolean {
  if (!isToolUIPart(part)) return false
  const toolName = getPartToolName(part)
  return toolName === REPORT_ARTIFACTS_TOOL_NAME || toolName.endsWith(`__${REPORT_ARTIFACTS_TOOL_NAME}`)
}

function isAskUserQuestionPart(part: CherryMessagePart): boolean {
  return isToolUIPart(part) && isAskUserQuestionToolName(getPartToolName(part))
}

function isInlineResultToolPart(part: CherryMessagePart): boolean {
  return (
    isChannelAuthQrPart(part) ||
    agentInlineResultPresentationRegistry.isResultPart(part) ||
    isGeneratedImageResultPart(part)
  )
}

function isVisibleReasoningPart(part: CherryMessagePart): boolean {
  if (part.type !== 'reasoning') return false
  return part.state === 'streaming' || isReasoningMessagePart(part)
}

export function isProcessToolPart(part: CherryMessagePart): boolean {
  if (!isToolUIPart(part) || isReportToolPart(part)) return false
  return !isAskUserQuestionPart(part) && !isInlineResultToolPart(part)
}

function isVisibleProcessPart(part: CherryMessagePart): boolean {
  return isVisibleReasoningPart(part) || isProcessToolPart(part)
}

export function isInlineLayoutPart(part: CherryMessagePart): boolean {
  if (isToolUIPart(part)) return !isProcessToolPart(part)
  return part.type === 'data-agent-session-fork' || (part.type !== 'text' && isSubstantiveAnswerPart(part))
}

function projectOrderedMessageParts(
  entries: readonly PartEntry[],
  keepIntermediateAssistantText: boolean
): MessagePartLayoutItem[] {
  const lastProcessIndex = entries.findLastIndex(({ part }) => isVisibleProcessPart(part))
  const items: MessagePartLayoutItem[] = []
  let process: PartEntry[] = []
  let inlineValue = false
  const flush = () => {
    if (!process.length) return
    const first = process[0]
    items.push({ kind: 'process', key: first.partId ?? first.index, entries: process })
    process = []
  }

  for (const [position, entry] of entries.entries()) {
    const { part } = entry
    const associated = inlineValue && isAssociatedResultPart(part)
    inlineValue = associated || (part.type !== 'text' && isSubstantiveAnswerPart(part))
    if (
      (position > lastProcessIndex && !(part.type === 'data-error' && process.length)) ||
      associated ||
      isInlineLayoutPart(part) ||
      (keepIntermediateAssistantText && part.type === 'text')
    ) {
      flush()
      items.push({ kind: 'part', key: entry.partId ?? entry.index, entry })
    } else {
      process.push(entry)
    }
  }
  flush()
  return items
}

export function projectLiveMessageParts(
  entries: readonly PartEntry[],
  { keepIntermediateAssistantText = false }: MessagePartLayoutOptions = {}
): MessagePartLayoutItem[] {
  const content = entries.filter((entry, position) => {
    const addressedStream = entry.partId && entry.part.type === 'text' && entry.part.state === 'streaming'
    return (
      !isHiddenPart(entry.part) &&
      (addressedStream || (!isIgnorableEmptyContentPart(entry.part) && !isProcessFillerText(entries, position, true)))
    )
  })
  return projectOrderedMessageParts(content, keepIntermediateAssistantText)
}

/**
 * Finds the original index of the only text/code part eligible for live
 * playout. Text must still be protocol-streaming, and only the final
 * non-hidden part can be open; hidden markers do not seal it.
 */
export function findOpenTextTailIndex(entries: readonly PartEntry[]): number | null {
  for (let position = entries.length - 1; position >= 0; position--) {
    const entry = entries[position]
    if (isHiddenPart(entry.part)) continue

    // Narrow on the part itself, not an aliased `type`, so `state` is typed.
    if (entry.part.type === 'text') {
      return entry.part.state === 'streaming' ? entry.index : null
    }
    return entry.part.type === 'data-code' ? entry.index : null
  }

  return null
}

/**
 * Does this part count as the assistant's actual answer (as opposed to process
 * noise like tool calls and reasoning)? The layout splits the process group at
 * the last such part.
 *
 * Switches on `part.type` directly rather than a `Set.has` + string alias:
 * `CherryMessagePart` is a discriminated union, so each `case` narrows `part`
 * and its payload is typed. Testing membership through an aliased
 * `const partType = part.type` never narrows, which is what forced the
 * `part as { text?: string }` / `part as { data?: … }` casts this replaces.
 */
export function isSubstantiveAnswerPart(part: CherryMessagePart): boolean {
  switch (part.type) {
    // Turn-start / agent-session folds sit on a turn boundary, so they read as a
    // separator and close the process group. An in-loop fold happens BETWEEN
    // tool calls of one continuous loop — treating it as substantive would split
    // that loop's group in two, with a rule drawn through the middle. Keep it
    // inside the group as a status row instead.
    case 'data-compaction-anchor':
      return part.data.phase !== 'in-loop'
    case 'data-conversation-reset':
      return true
    case 'text':
      return !!part.text?.trim() || hasVisibleComposerToken(part)
    case 'data-code':
    case 'data-compact':
    case 'data-translation':
      return !!part.data?.content?.trim()
    default:
      return false
  }
}

function isAssociatedResultPart(part: CherryMessagePart): boolean {
  return ASSOCIATED_RESULT_PART_TYPES.has(part.type)
}

export function isReasoningMessagePart(part: CherryMessagePart): boolean {
  return part.type === 'reasoning' && !!part.text?.trim()
}

export function isResultPart(part: CherryMessagePart): boolean {
  return isSubstantiveAnswerPart(part) || isAssociatedResultPart(part)
}

export function projectCompletedMessageParts(
  entries: readonly PartEntry[],
  { keepIntermediateAssistantText = false }: MessagePartLayoutOptions = {}
): CompletedMessagePartLayout {
  const reportEntries: PartEntry[] = []
  const content = entries.filter((entry, position) => {
    if (isReportToolPart(entry.part)) {
      reportEntries.push(entry)
      return false
    }
    return (
      !isHiddenPart(entry.part) && !isEmptyContentPart(entry.part) && !isProcessFillerText(entries, position, false)
    )
  })
  return { items: projectOrderedMessageParts(content, keepIntermediateAssistantText), reportEntries }
}
