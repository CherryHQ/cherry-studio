import { concat, foldLayout, single, type Range } from '@renderer/utils/message/projectionRange'
import type { CherryMessagePart } from '@shared/data/types/message'

import type { ToolRenderItem } from '../tools/toolResponse'
import { joinRuns, type Runs } from './livePartRanges'
import type { PlaceholderStatus } from './PlaceholderBlock'

export interface AddressedEntry {
  key: string
  part: CherryMessagePart
}
export interface ToolFold {
  key: string
  title?: string
  first: ToolRenderItem
  last: ToolRenderItem
  items: Range<ToolRenderItem>
}
export interface HistoryRun {
  key: string
  kind: 'process' | 'content' | 'images' | 'video' | 'barrier'
  entries: Range<AddressedEntry>
  end: AddressedEntry
  toolCount?: number
  startsWithTool?: boolean
  firstTool?: ToolRenderItem
  lastTool?: ToolRenderItem
  waiting?: ToolRenderItem
  running?: ToolRenderItem
  hasIntent?: boolean
  folds?: Runs<ToolFold>
}
export interface PartLayout {
  history?: Runs<HistoryRun>
  tailHistory?: Runs<HistoryRun>
  kept?: Range<AddressedEntry>
  tail?: Range<AddressedEntry>
  tailText?: Range<AddressedEntry>
  lastProcess?: string
  openTail?: string
  trailingAnswer?: boolean
  lastBody?: string
  side?: Range<AddressedEntry>
  pending?: Range<string>
  visible?: boolean
  status?: PlaceholderStatus
}

export function joinToolFolds(left: ToolFold, right: ToolFold): ToolFold | undefined {
  if (!left.title || left.title !== right.title) return
  return { ...left, last: right.last, items: concat(left.items, right.items)! }
}

function joinHistory(left: HistoryRun, right: HistoryRun): HistoryRun | undefined {
  if (left.kind !== right.kind || left.kind === 'content' || left.kind === 'barrier') return
  if (
    left.kind === 'video' &&
    left.end.part.type === 'data-video' &&
    right.end.part.type === 'data-video' &&
    left.end.part.data.filePath !== right.end.part.data.filePath
  )
    return
  return {
    ...left,
    entries: concat(left.entries, right.entries)!,
    end: right.end,
    toolCount: (left.toolCount ?? 0) + (right.toolCount ?? 0),
    firstTool: left.firstTool ?? right.firstTool,
    lastTool: right.lastTool ?? left.lastTool,
    waiting: right.waiting ?? left.waiting,
    running: right.running ?? left.running,
    hasIntent: left.hasIntent || right.hasIntent,
    folds: joinRuns(
      left.folds,
      right.folds,
      right.startsWithTool && left.end.key === left.lastTool?.id ? joinToolFolds : () => undefined
    )
  }
}

const history = (a?: Runs<HistoryRun>, b?: Runs<HistoryRun>) => joinRuns(a, b, joinHistory)

export const EMPTY_LAYOUT: PartLayout = {}

export function joinPartLayout(left: PartLayout, right: PartLayout): PartLayout {
  if (left === EMPTY_LAYOUT) return right
  if (right === EMPTY_LAYOUT) return left
  const sealed = !!right.lastProcess
  return {
    history: sealed ? history(history(left.history, left.tailHistory), right.history) : left.history,
    tailHistory: sealed ? right.tailHistory : history(left.tailHistory, right.tailHistory),
    kept: sealed ? concat(concat(left.kept, left.tailText), right.kept) : left.kept,
    tail: sealed ? right.tail : concat(left.tail, right.tail),
    tailText: sealed ? right.tailText : concat(left.tailText, right.tailText),
    lastProcess: right.lastProcess ?? left.lastProcess,
    openTail: right.lastBody !== undefined ? right.openTail : left.openTail,
    lastBody: right.lastBody ?? left.lastBody,
    trailingAnswer: right.trailingAnswer ?? left.trailingAnswer,
    side: concat(left.side, right.side),
    pending: concat(left.pending, right.pending),
    status: right.status ?? left.status,
    visible: left.visible || right.visible
  }
}

export function layoutPart(
  entry: AddressedEntry,
  kind: HistoryRun['kind'],
  keepText: boolean,
  tool?: ToolRenderItem,
  intentTitle?: string
): PartLayout {
  const { key, part } = entry
  const entries = single(key, entry)
  const fold = tool && { key, title: intentTitle, first: tool, last: tool, items: single(key, tool) }
  const run: HistoryRun = {
    key,
    kind,
    entries,
    end: entry,
    toolCount: tool ? 1 : 0,
    startsWithTool: !!tool,
    firstTool: tool,
    lastTool: tool,
    waiting: tool && 'state' in part && part.state === 'approval-requested' ? tool : undefined,
    running:
      tool &&
      (tool.toolResponse.status === 'invoking' ||
        tool.toolResponse.status === 'streaming' ||
        tool.toolResponse.status === 'pending')
        ? tool
        : undefined,
    hasIntent: !!intentTitle,
    folds: fold ? { first: fold } : undefined
  }
  const process = kind === 'process'
  return {
    history: process ? { first: run } : undefined,
    tailHistory: !process && !keepText ? { first: run } : undefined,
    tail: process || kind === 'barrier' ? undefined : entries,
    tailText: keepText ? entries : undefined,
    lastProcess: process ? key : undefined,
    lastBody: key,
    openTail: part.type === 'data-code' || (part.type === 'text' && part.state === 'streaming') ? key : undefined
  }
}

interface FillerContext {
  layout: PartLayout
  beforeProcess?: PartLayout
  first?: 'process' | 'content'
  last?: 'process' | 'content'
}

/** A settled ellipsis waits for the next meaningful part. Both possible layouts share the settled prefix. */
export function projectAddressedLayout(admit: (id: string) => FillerContext) {
  const fold = foldLayout<FillerContext>(
    ({ partId }) => admit(partId),
    (a, b) => {
      const left = b.first === 'process' ? (a.beforeProcess ?? a.layout) : a.layout
      const layout = joinPartLayout(left, b.layout)
      const alternative = b.beforeProcess || (!b.first && a.beforeProcess)
      return {
        layout,
        beforeProcess: alternative
          ? joinPartLayout(b.first ? left : (a.beforeProcess ?? left), b.beforeProcess ?? b.layout)
          : undefined,
        first: a.first ?? b.first,
        last: b.last ?? a.last
      }
    },
    { layout: EMPTY_LAYOUT }
  )
  return (node: Parameters<typeof fold>[0]): PartLayout => {
    const result = fold(node)
    return result.last === 'process' ? (result.beforeProcess ?? result.layout) : result.layout
  }
}
