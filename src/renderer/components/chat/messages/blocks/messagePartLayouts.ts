import { REPORT_ARTIFACTS_TOOL_NAME } from '@shared/ai/builtinTools'
import type { CherryMessagePart, ReasoningUIPart } from '@shared/data/types/message'
import { getToolName, isToolUIPart } from 'ai'

import { isAskUserQuestionToolName } from '../tools/shared/agentToolTypes'

export interface PartEntry {
  part: CherryMessagePart
  index: number
}

export interface LiveProcessLayoutItem {
  kind: 'process'
  /** Original index of the first visible entry in this process history. */
  key: number
  entries: readonly PartEntry[]
}

export interface LivePartLayoutItem {
  kind: 'part'
  key: number
  entry: PartEntry
}

export type LiveMessagePartLayoutItem = LiveProcessLayoutItem | LivePartLayoutItem

export interface CompletedMessagePartLayout {
  historyEntries: readonly PartEntry[]
  resultEntries: readonly PartEntry[]
  reportEntries: readonly PartEntry[]
}

const HIDDEN_PART_TYPES = new Set([
  'step-start',
  'source-url',
  'source-document',
  'data-citation',
  'data-agent-task-event'
])

const SUBSTANTIVE_ANSWER_PART_TYPES = new Set([
  'text',
  'data-code',
  'data-compact',
  'data-translation',
  'data-compaction-anchor'
])

const ASSOCIATED_RESULT_PART_TYPES = new Set(['data-error', 'file', 'data-video'])

export function isHiddenPart(part: CherryMessagePart): boolean {
  return HIDDEN_PART_TYPES.has(part.type as string)
}

function isIgnorableEmptyContentPart(part: CherryMessagePart): boolean {
  if ((part.type as string) === 'text') return isEmptyContentPart(part)
  if ((part.type as string) !== 'reasoning') return false
  const reasoningPart = part as ReasoningUIPart
  return reasoningPart.state !== 'streaming' && isEmptyContentPart(part)
}

function isEmptyContentPart(part: CherryMessagePart): boolean {
  const partType = part.type as string
  if (partType !== 'text' && partType !== 'reasoning') return false
  return !(part as { text?: string }).text?.trim()
}

function isEllipsisOnlyTextPart(part: CherryMessagePart): boolean {
  if ((part.type as string) !== 'text') return false
  return /^(?:\.{3}|…)$/.test((part as { text?: string }).text?.trim() ?? '')
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
  return !!part && (isToolUIPart(part) || (part.type as string) === 'reasoning')
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

function isVisibleReasoningPart(part: CherryMessagePart): boolean {
  if ((part.type as string) !== 'reasoning') return false
  const reasoningPart = part as ReasoningUIPart
  return reasoningPart.state === 'streaming' || isReasoningMessagePart(part)
}

function isFoldableToolPart(part: CherryMessagePart): boolean {
  if (!isToolUIPart(part) || isReportToolPart(part)) return false
  return !isAskUserQuestionToolName(getPartToolName(part))
}

function isVisibleProcessPart(part: CherryMessagePart): boolean {
  return isVisibleReasoningPart(part) || isFoldableToolPart(part)
}

/**
 * Projects an active message into stable, ordered layout items.
 *
 * Hidden transport markers are discarded without splitting process history.
 * Within each region bounded by an interactive or side-channel tool, visible
 * content through the last reasoning/tool part belongs to one process item.
 * Only the trailing content remains outside as the current result candidate.
 */
export function projectLiveMessageParts(entries: readonly PartEntry[]): LiveMessagePartLayoutItem[] {
  const items: LiveMessagePartLayoutItem[] = []
  let regionEntries: PartEntry[] = []

  const flushRegion = () => {
    let lastProcessPosition = -1
    for (let position = regionEntries.length - 1; position >= 0; position--) {
      if (isVisibleProcessPart(regionEntries[position].part)) {
        lastProcessPosition = position
        break
      }
    }

    if (lastProcessPosition >= 0) {
      const processEntries = regionEntries.slice(0, lastProcessPosition + 1)
      items.push({ kind: 'process', key: processEntries[0].index, entries: processEntries })
    }

    const resultStart = lastProcessPosition + 1
    for (let position = resultStart; position < regionEntries.length; position++) {
      const entry = regionEntries[position]
      items.push({ kind: 'part', key: entry.index, entry })
    }

    regionEntries = []
  }

  for (let position = 0; position < entries.length; position++) {
    const entry = entries[position]
    if (isIgnorableEmptyContentPart(entry.part)) continue
    if (isHiddenPart(entry.part)) continue
    if (isProcessFillerText(entries, position, true)) continue

    if (isToolUIPart(entry.part) && !isVisibleProcessPart(entry.part)) {
      flushRegion()
      items.push({ kind: 'part', key: entry.index, entry })
      continue
    }

    regionEntries.push(entry)
  }

  flushRegion()
  return items
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

    const partType = entry.part.type as string
    if (partType === 'text') {
      return (entry.part as { state?: string }).state === 'streaming' ? entry.index : null
    }
    return partType === 'data-code' ? entry.index : null
  }

  return null
}

export function isSubstantiveAnswerPart(part: CherryMessagePart): boolean {
  const partType = part.type as string
  if (!SUBSTANTIVE_ANSWER_PART_TYPES.has(partType)) return false
  if (partType === 'data-compaction-anchor') return true
  if (partType === 'text') return !!(part as { text?: string }).text?.trim()
  return !!(part as { data?: { content?: string } }).data?.content?.trim()
}

function isAssociatedResultPart(part: CherryMessagePart): boolean {
  return ASSOCIATED_RESULT_PART_TYPES.has(part.type as string)
}

export function isReasoningMessagePart(part: CherryMessagePart): boolean {
  return (part.type as string) === 'reasoning' && !!(part as ReasoningUIPart).text?.trim()
}

export function isResultPart(part: CherryMessagePart): boolean {
  return isSubstantiveAnswerPart(part) || isAssociatedResultPart(part)
}

/**
 * Projects a terminal message into completed history, final result, and report
 * artifact side-channel entries. Active messages must use
 * {@link projectLiveMessageParts}; this function intentionally performs no
 * streaming-state inference.
 */
export function projectCompletedMessageParts(entries: readonly PartEntry[]): CompletedMessagePartLayout {
  const reportEntries: PartEntry[] = []
  const contentEntries: PartEntry[] = []

  for (let position = 0; position < entries.length; position++) {
    const entry = entries[position]
    if (isReportToolPart(entry.part)) {
      reportEntries.push(entry)
    } else if (!isEmptyContentPart(entry.part) && !isProcessFillerText(entries, position, false)) {
      contentEntries.push(entry)
    }
  }

  let lastAnswerPosition = -1
  for (let position = contentEntries.length - 1; position >= 0; position--) {
    if (isSubstantiveAnswerPart(contentEntries[position].part)) {
      lastAnswerPosition = position
      break
    }
  }

  let resultStart = -1
  let resultEnd = -1
  if (lastAnswerPosition >= 0) {
    resultStart = lastAnswerPosition
    while (
      resultStart > 0 &&
      (isSubstantiveAnswerPart(contentEntries[resultStart - 1].part) ||
        isAssociatedResultPart(contentEntries[resultStart - 1].part) ||
        isHiddenPart(contentEntries[resultStart - 1].part))
    ) {
      resultStart--
    }

    resultEnd = lastAnswerPosition + 1
    while (
      resultEnd < contentEntries.length &&
      (isAssociatedResultPart(contentEntries[resultEnd].part) || isHiddenPart(contentEntries[resultEnd].part))
    ) {
      resultEnd++
    }
  } else {
    // Value-only responses (generated files, media, or terminal errors) have
    // no prose answer to anchor them. Keep only the final uninterrupted value
    // tail outside process history; an ending tool/reasoning part seals it.
    let tailPosition = contentEntries.length - 1
    while (tailPosition >= 0 && isHiddenPart(contentEntries[tailPosition].part)) tailPosition--
    if (tailPosition >= 0 && isAssociatedResultPart(contentEntries[tailPosition].part)) {
      resultEnd = contentEntries.length
      resultStart = tailPosition
      while (
        resultStart > 0 &&
        (isAssociatedResultPart(contentEntries[resultStart - 1].part) ||
          isHiddenPart(contentEntries[resultStart - 1].part))
      ) {
        resultStart--
      }
    }
  }

  const isDirectResult = (_entry: PartEntry, position: number) => position >= resultStart && position < resultEnd

  return {
    historyEntries: contentEntries.filter((entry, position) => !isDirectResult(entry, position)),
    resultEntries: contentEntries.filter(isDirectResult),
    reportEntries
  }
}
