import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@cherrystudio/ui'
import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import type { CherryMessagePart } from '@shared/data/types/message'
import {
  Brain,
  CalendarDays,
  Database,
  FileSearch,
  FileText,
  Globe,
  ImageIcon,
  ListChecks,
  type LucideIcon,
  Mail,
  Sparkles,
  SquareTerminal,
  Wrench
} from 'lucide-react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { BeatLoader } from 'react-spinners'

import MessageTools from '../tools/MessageTools'
import { AgentToolsType } from '../tools/shared/agentToolTypes'
import { getEffectiveStatus, type ToolStatus } from '../tools/shared/GenericTools'
import ToolHeader, { getReadableToolActivity } from '../tools/ToolHeader'
import { isToolPartAwaitingApproval, type ToolRenderItem, type ToolResponseLike } from '../tools/toolResponse'
import BlockErrorFallback from './BlockErrorFallback'
import { PartsContext, PartsProvider, usePartsMap } from './MessagePartsContext'
import { PlaceholderShimmerText } from './PlaceholderShimmerText'
import { useRequestScrollFollowRecovery } from './ScrollOwnershipContext'
import { useScrollAnchor } from './useScrollAnchor'

// ============ Types & Helpers ============

function isToolGroupItemCompleted(status: ToolResponseLike['status'] | undefined): boolean {
  return status === 'done' || status === 'error' || status === 'cancelled'
}

// Calculate actual waiting state for a tool item (not depending on hooks).
// AI-SDK-v6 ToolUIPart state (`approval-requested`) is the sole source of truth.
function getItemIsWaiting(item: ToolRenderItem, partsMap: Record<string, CherryMessagePart[]> | null): boolean {
  if (item.toolResponse.status !== 'pending') return false
  return isToolPartAwaitingApproval(partsMap, item.toolResponse.toolCallId)
}

// Get effective UI status for an item
function getItemEffectiveStatus(
  item: ToolRenderItem,
  partsMap: Record<string, CherryMessagePart[]> | null
): ToolStatus {
  const isWaiting = getItemIsWaiting(item, partsMap)
  return getEffectiveStatus(item.toolResponse?.status, isWaiting)
}

// ============ Sub-Components ============

const LIVE_HEADER_MIN_DURATION_MS = 1200

type ToolHeaderCandidate =
  | { key: string; kind: 'summary'; label: React.ReactNode }
  | { key: string; kind: 'activity'; label: React.ReactNode }
  | { key: string; kind: 'tool'; item: ToolRenderItem; status: ToolStatus }

const TOOL_GROUP_ICON_BY_NAME: Record<string, LucideIcon> = {
  [AgentToolsType.Agent]: Sparkles,
  [AgentToolsType.Bash]: SquareTerminal,
  [AgentToolsType.BashOutput]: SquareTerminal,
  [AgentToolsType.Edit]: FileText,
  [AgentToolsType.Glob]: FileSearch,
  [AgentToolsType.Grep]: FileSearch,
  [AgentToolsType.ListMcpResources]: FileSearch,
  [AgentToolsType.MultiEdit]: FileText,
  [AgentToolsType.NotebookEdit]: FileText,
  [AgentToolsType.Read]: FileText,
  [AgentToolsType.ReadMcpResource]: FileSearch,
  [AgentToolsType.Search]: FileSearch,
  [AgentToolsType.Skill]: Sparkles,
  [AgentToolsType.Task]: ListChecks,
  [AgentToolsType.TaskCreate]: ListChecks,
  [AgentToolsType.TaskGet]: ListChecks,
  [AgentToolsType.TaskList]: ListChecks,
  [AgentToolsType.TaskOutput]: ListChecks,
  [AgentToolsType.TaskStop]: ListChecks,
  [AgentToolsType.TaskUpdate]: ListChecks,
  [AgentToolsType.TodoWrite]: ListChecks,
  [AgentToolsType.ToolSearch]: FileSearch,
  [AgentToolsType.WebFetch]: Globe,
  [AgentToolsType.WebSearch]: Globe,
  [AgentToolsType.Write]: FileText
}
const TOOL_GROUP_ICON_CLASS_NAME =
  'size-3.5 text-foreground-muted transition-colors duration-150 group-hover/tool-group-trigger:text-foreground'

type ToolGroupTool = ToolRenderItem['toolResponse']['tool']
type McpActivityAction = 'analyze' | 'create' | 'delete' | 'execute' | 'modify' | 'search' | 'send' | 'view'
type McpActivityTarget =
  | 'calendar'
  | 'data'
  | 'documentFiles'
  | 'email'
  | 'imageFiles'
  | 'relatedContent'
  | 'taskList'
  | 'webPage'
  | 'webSearch'

interface McpToolGroupPresentation {
  action?: McpActivityAction
  icon: LucideIcon
  target?: McpActivityTarget
}

const MCP_LABEL_KEYS_BY_ACTION: Record<McpActivityAction, [inactive: string, active: string]> = {
  analyze: ['analyze', 'analyzing'],
  create: ['create', 'creating'],
  delete: ['delete', 'deleting'],
  execute: ['executeCommand', 'executingCommand'],
  modify: ['modify', 'modifying'],
  search: ['search', 'searching'],
  send: ['send', 'sending'],
  view: ['view', 'viewing']
}
const MCP_ANALYZE_PATTERN = /_(?:analyze|inspect|summarize)_/
const MCP_CALENDAR_PATTERN = /_(?:calendar|event|schedule)_/
const MCP_CREATE_PATTERN = /_(?:create|insert|new)_/
const MCP_DATA_PATTERN = /_(?:database|dataset|record|sql|table)_/
const MCP_DELETE_PATTERN = /_(?:delete|remove)_/
const MCP_DOCUMENT_PATTERN = /_(?:document|file|markdown|pdf)_/
const MCP_EMAIL_PATTERN = /_(?:mail|email|message)_/
const MCP_EXECUTE_PATTERN = /_(?:call|execute|invoke|run)_/
const MCP_IMAGE_PATTERN = /_(?:image|photo|picture)_/
const MCP_MODIFY_PATTERN = /_(?:edit|patch|update|write)_/
const MCP_SEARCH_PATTERN = /_(?:find|query|search)_/
const MCP_SEND_PATTERN = /_(?:publish|send|upload)_/
const MCP_TASK_PATTERN = /_(?:tasks?|todos?)_/
const MCP_VIEW_PATTERN = /_(?:fetch|get|list|read|view)_/
const MCP_WEB_PATTERN = /_(?:browser|fetch_markdown|http|url|web|website)_/

function normalizeToolSemanticText(value: string): string {
  return `_${value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')}_`
}

function getMcpRuntimeAction(args: unknown): McpActivityAction | undefined {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return undefined

  const action = 'action' in args && typeof args.action === 'string' ? normalizeToolSemanticText(args.action) : ''
  if (MCP_DELETE_PATTERN.test(action)) return 'delete'
  if (MCP_CREATE_PATTERN.test(action) || action === '_add_') return 'create'
  if (MCP_MODIFY_PATTERN.test(action)) return 'modify'
  if (MCP_SEND_PATTERN.test(action)) return 'send'
  if (MCP_ANALYZE_PATTERN.test(action)) return 'analyze'
  if (MCP_SEARCH_PATTERN.test(action)) return 'search'
  if (MCP_VIEW_PATTERN.test(action)) return 'view'
  if (MCP_EXECUTE_PATTERN.test(action)) return 'execute'
  return undefined
}

function getMcpToolGroupPresentation(
  tool: ToolGroupTool | undefined,
  args?: unknown
): McpToolGroupPresentation | undefined {
  if (!tool || (tool.type !== 'mcp' && !tool.id.startsWith('mcp__') && !tool.name.startsWith('mcp__'))) {
    return undefined
  }

  const serverName = 'serverName' in tool && typeof tool.serverName === 'string' ? tool.serverName : ''
  const identityText = normalizeToolSemanticText(`${serverName} ${tool.id} ${tool.name}`)
  const targetText = normalizeToolSemanticText(`${serverName} ${tool.id} ${tool.name} ${tool.description ?? ''}`)

  let target: McpActivityTarget | undefined
  let icon: LucideIcon = Sparkles
  if (MCP_EMAIL_PATTERN.test(targetText)) {
    target = 'email'
    icon = Mail
  } else if (MCP_CALENDAR_PATTERN.test(targetText)) {
    target = 'calendar'
    icon = CalendarDays
  } else if (MCP_DATA_PATTERN.test(targetText)) {
    target = 'data'
    icon = Database
  } else if (MCP_IMAGE_PATTERN.test(targetText)) {
    target = 'imageFiles'
    icon = ImageIcon
  } else if (MCP_TASK_PATTERN.test(targetText)) {
    target = 'taskList'
    icon = ListChecks
  } else if (MCP_WEB_PATTERN.test(targetText)) {
    target = MCP_SEARCH_PATTERN.test(targetText) ? 'webSearch' : 'webPage'
    icon = Globe
  } else if (MCP_DOCUMENT_PATTERN.test(targetText)) {
    target = 'documentFiles'
    icon = FileText
  }

  let action = getMcpRuntimeAction(args)
  if (!action) {
    if (MCP_DELETE_PATTERN.test(identityText)) action = 'delete'
    else if (MCP_CREATE_PATTERN.test(identityText)) action = 'create'
    else if (MCP_MODIFY_PATTERN.test(identityText)) action = 'modify'
    else if (MCP_SEND_PATTERN.test(identityText)) action = 'send'
    else if (MCP_ANALYZE_PATTERN.test(identityText)) action = 'analyze'
    else if (MCP_SEARCH_PATTERN.test(identityText)) action = 'search'
    else if (MCP_VIEW_PATTERN.test(identityText)) action = 'view'
    else if (MCP_EXECUTE_PATTERN.test(identityText)) action = 'execute'
  }

  if (icon === Sparkles) {
    if (action === 'search') icon = FileSearch
    else if (action === 'execute') icon = SquareTerminal
    else if (action === 'create' || action === 'delete' || action === 'modify') icon = FileText
  }

  return { action, icon, target: target ?? (action ? 'relatedContent' : undefined) }
}

function ToolGroupContentIcon({ tool, toolArguments }: { tool?: ToolGroupTool; toolArguments?: unknown }) {
  const Icon =
    (tool && TOOL_GROUP_ICON_BY_NAME[tool.name]) || getMcpToolGroupPresentation(tool, toolArguments)?.icon || Wrench
  return <Icon aria-hidden="true" className={TOOL_GROUP_ICON_CLASS_NAME} />
}

function getActivityCandidateKey(label: React.ReactNode): string {
  return typeof label === 'string' || typeof label === 'number' ? `activity:${label}` : 'activity'
}

function isErrorHeaderCandidate(candidate: ToolHeaderCandidate): boolean {
  return (
    candidate.kind === 'tool' &&
    (candidate.status === 'error' || candidate.item.toolResponse.response?.isError === true)
  )
}

function shouldBypassHeaderStabilization(
  currentCandidate: ToolHeaderCandidate,
  nextCandidate: ToolHeaderCandidate
): boolean {
  return (
    (nextCandidate.kind === 'tool' && nextCandidate.status === 'waiting') ||
    isErrorHeaderCandidate(nextCandidate) ||
    isErrorHeaderCandidate(currentCandidate)
  )
}

function useStableHeaderCandidate(
  nextCandidate: ToolHeaderCandidate,
  isLiveProgress: boolean | undefined
): ToolHeaderCandidate {
  const [displayCandidate, setDisplayCandidate] = React.useState(nextCandidate)
  const displayCandidateRef = React.useRef(nextCandidate)
  const lastChangeAtRef = React.useRef(Date.now())
  const pendingCandidateRef = React.useRef<ToolHeaderCandidate | null>(null)
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(() => {
    const clearPendingTimer = () => {
      if (!timerRef.current) return
      clearTimeout(timerRef.current)
      timerRef.current = null
    }

    const commitCandidate = (candidate: ToolHeaderCandidate) => {
      displayCandidateRef.current = candidate
      lastChangeAtRef.current = Date.now()
      setDisplayCandidate(candidate)
    }

    if (displayCandidateRef.current.key === nextCandidate.key) {
      clearPendingTimer()
      pendingCandidateRef.current = null
      displayCandidateRef.current = nextCandidate
      return clearPendingTimer
    }

    if (!isLiveProgress || shouldBypassHeaderStabilization(displayCandidateRef.current, nextCandidate)) {
      clearPendingTimer()
      pendingCandidateRef.current = null
      commitCandidate(nextCandidate)
      return clearPendingTimer
    }

    pendingCandidateRef.current = nextCandidate
    const elapsedMs = Date.now() - lastChangeAtRef.current
    const remainingMs = Math.max(0, LIVE_HEADER_MIN_DURATION_MS - elapsedMs)

    clearPendingTimer()
    timerRef.current = setTimeout(() => {
      const pendingCandidate = pendingCandidateRef.current
      if (!pendingCandidate) return
      pendingCandidateRef.current = null
      timerRef.current = null
      commitCandidate(pendingCandidate)
    }, remainingMs)

    return clearPendingTimer
  }, [isLiveProgress, nextCandidate])

  if (!isLiveProgress || shouldBypassHeaderStabilization(displayCandidateRef.current, nextCandidate)) {
    return nextCandidate
  }

  if (displayCandidateRef.current.key === nextCandidate.key) {
    return nextCandidate
  }

  return displayCandidate
}

interface ToolBlockGroupHeaderContentProps {
  items: ToolRenderItem[]
  activityLabel?: React.ReactNode
  activityIcon?: React.ReactNode
  elapsedText?: React.ReactNode
  summary?: React.ReactNode
  isLiveProgress?: boolean
  preferSummary?: boolean
  semanticToolTitle?: boolean
  showContentIcon?: boolean
  showLatestWhenComplete?: boolean
  summaryIcon?: React.ReactNode
}

function getMcpToolGroupActivity(
  presentation: McpToolGroupPresentation,
  isActive: boolean,
  t: ReturnType<typeof useTranslation>['t']
) {
  if (!presentation.action) {
    return { label: t(`message.tools.activity.${isActive ? 'usingExtension' : 'usedExtension'}`) }
  }

  const [inactiveLabelKey, activeLabelKey] = MCP_LABEL_KEYS_BY_ACTION[presentation.action]
  return {
    label: t(`message.tools.activity.${isActive ? activeLabelKey : inactiveLabelKey}`),
    description: presentation.target ? t(`message.tools.activity.${presentation.target}`) : undefined
  }
}

function getSemanticToolTitle(
  candidate: Extract<ToolHeaderCandidate, { kind: 'tool' }>,
  t: ReturnType<typeof useTranslation>['t']
) {
  const { toolResponse } = candidate.item
  const isActive = candidate.status === 'invoking' || candidate.status === 'streaming' || candidate.status === 'waiting'
  const mcpPresentation = getMcpToolGroupPresentation(toolResponse.tool, toolResponse.arguments)
  if (mcpPresentation && candidate.status === 'error') return t('message.tools.activity.extensionFailed')

  const activity =
    getReadableToolActivity(toolResponse.tool.name, toolResponse.arguments, isActive, t) ??
    (mcpPresentation ? getMcpToolGroupActivity(mcpPresentation, isActive, t) : undefined)
  if (!activity) return t(isActive ? 'message.processing' : 'message.tools.processed')
  if (!activity.description) return activity.label

  return activity.description.toLocaleLowerCase().includes(activity.label.toLocaleLowerCase())
    ? activity.description
    : `${activity.label} ${activity.description}`
}

const DynamicToolBlockGroupHeaderContent = React.memo(
  ({
    items,
    activityLabel,
    activityIcon,
    elapsedText,
    summary,
    isLiveProgress,
    preferSummary,
    semanticToolTitle,
    showContentIcon,
    summaryIcon,
    showLatestWhenComplete
  }: ToolBlockGroupHeaderContentProps) => {
    const { t } = useTranslation()
    const partsMap = usePartsMap()
    const allCompleted = items.every((item) => isToolGroupItemCompleted(item.toolResponse.status))
    const fallbackLabel = summary ?? t('message.tools.groupHeader', { count: items.length })
    const nextCandidate = React.useMemo<ToolHeaderCandidate>(() => {
      if (preferSummary) {
        return { key: `summary:${String(fallbackLabel)}`, kind: 'summary', label: fallbackLabel }
      }

      if (activityLabel) {
        return { key: getActivityCandidateKey(activityLabel), kind: 'activity', label: activityLabel }
      }

      if (allCompleted && !showLatestWhenComplete) {
        return { key: `summary:${String(fallbackLabel)}`, kind: 'summary', label: fallbackLabel }
      }

      // Find items actually waiting for approval (using effective status)
      const waitingItems = items.filter((item) => getItemEffectiveStatus(item, partsMap) === 'waiting')

      // Prioritize showing waiting items that need approval
      const lastWaitingItem = waitingItems[waitingItems.length - 1]
      if (lastWaitingItem) {
        return { key: `${lastWaitingItem.id}:waiting`, kind: 'tool', item: lastWaitingItem, status: 'waiting' }
      }

      // Find running items (invoking or streaming)
      const runningItems = items.filter((item) => {
        const status = getItemEffectiveStatus(item, partsMap)
        return status === 'invoking' || status === 'streaming'
      })

      // Get the last running item (most recent) and render with animation
      const lastRunningItem = runningItems[runningItems.length - 1]
      if (lastRunningItem) {
        const lastRunningStatus = getItemEffectiveStatus(lastRunningItem, partsMap)
        return {
          key: `${lastRunningItem.id}:${lastRunningStatus}`,
          kind: 'tool',
          item: lastRunningItem,
          status: lastRunningStatus
        }
      }

      const latestItem = showLatestWhenComplete ? items.at(-1) : undefined
      if (latestItem) {
        const effectiveStatus = getItemEffectiveStatus(latestItem, partsMap)
        const latestStatus = latestItem.toolResponse.response?.isError === true ? 'error' : effectiveStatus
        return { key: `${latestItem.id}:${latestStatus}`, kind: 'tool', item: latestItem, status: latestStatus }
      }

      return { key: `summary:${String(fallbackLabel)}`, kind: 'summary', label: fallbackLabel }
    }, [activityLabel, allCompleted, fallbackLabel, items, partsMap, preferSummary, showLatestWhenComplete])
    const displayCandidate = useStableHeaderCandidate(nextCandidate, isLiveProgress)
    const renderWithElapsed = (content: React.ReactNode, icon?: React.ReactNode) => (
      <div className="flex min-w-0 max-w-full items-center gap-1.5 overflow-hidden text-[13px]">
        {icon && (
          <span
            aria-hidden="true"
            className="flex size-3.5 shrink-0 items-center justify-center text-foreground-muted transition-colors duration-150 group-hover/tool-group-trigger:text-foreground"
            data-testid="tool-group-content-icon">
            {icon}
          </span>
        )}
        <div className="min-w-0 overflow-hidden">{content}</div>
        {elapsedText && (
          <>
            <span aria-hidden="true" className="shrink-0 text-muted-foreground/40">
              ·
            </span>
            <span className="shrink-0 whitespace-nowrap text-muted-foreground/55 transition-colors duration-150 group-hover/tool-group-trigger:text-foreground">
              {elapsedText}
            </span>
          </>
        )}
      </div>
    )
    const renderSemanticTitle = (title: React.ReactNode, icon?: React.ReactNode, key?: React.Key) =>
      renderWithElapsed(
        <div className="flex min-w-0 max-w-full items-center gap-1.5 overflow-hidden text-[13px]" key={key}>
          <span className="block truncate font-normal text-foreground-muted transition-colors duration-150 group-hover/tool-group-trigger:text-foreground">
            {title}
          </span>
          {isLiveProgress && (
            <span aria-hidden="true" className="flex shrink-0 items-center">
              <BeatLoader color="var(--color-foreground-muted)" size={4} speedMultiplier={0.8} />
            </span>
          )}
        </div>,
        icon
      )

    const latestTool = items.at(-1)?.toolResponse
    const latestToolIcon = showContentIcon ? (
      <ToolGroupContentIcon tool={latestTool?.tool} toolArguments={latestTool?.arguments} />
    ) : undefined

    if (displayCandidate.kind === 'summary') {
      return renderWithElapsed(
        <div className="flex items-center text-[13px]">
          <span className="whitespace-nowrap font-normal text-foreground-muted transition-colors duration-150 group-hover/tool-group-trigger:text-foreground">
            {displayCandidate.label}
          </span>
        </div>,
        summaryIcon ?? latestToolIcon
      )
    }

    if (displayCandidate.kind === 'activity') {
      if (semanticToolTitle) return renderSemanticTitle(displayCandidate.label, activityIcon ?? latestToolIcon)

      return renderWithElapsed(
        <div className="flex min-w-0 items-center text-[13px]">
          <PlaceholderShimmerText className="truncate font-normal text-foreground-muted transition-colors duration-150 group-hover/tool-group-trigger:text-foreground">
            {displayCandidate.label}
          </PlaceholderShimmerText>
        </div>
      )
    }

    if (semanticToolTitle) {
      const title = getSemanticToolTitle(displayCandidate, t)
      const icon = showContentIcon ? (
        <ToolGroupContentIcon
          tool={displayCandidate.item.toolResponse.tool}
          toolArguments={displayCandidate.item.toolResponse.arguments}
        />
      ) : undefined
      return renderSemanticTitle(title, icon, displayCandidate.item.id)
    }

    return renderWithElapsed(
      <div className="min-w-0 max-w-full overflow-hidden" key={displayCandidate.item.id}>
        <ToolHeader
          toolResponse={displayCandidate.item.toolResponse}
          variant="collapse-label"
          status={displayCandidate.status}
          shimmer={isLiveProgress}
        />
      </div>
    )
  }
)
DynamicToolBlockGroupHeaderContent.displayName = 'DynamicToolBlockGroupHeaderContent'

export const ToolBlockGroupHeaderContent = React.memo((props: ToolBlockGroupHeaderContentProps) => {
  const { t } = useTranslation()
  const {
    activityLabel,
    elapsedText,
    items,
    preferSummary,
    showContentIcon,
    showLatestWhenComplete,
    summary,
    summaryIcon
  } = props
  const allCompleted = items.every((item) => isToolGroupItemCompleted(item.toolResponse.status))
  const fallbackLabel = summary ?? t('message.tools.groupHeader', { count: items.length })

  if (preferSummary || (allCompleted && !showLatestWhenComplete && !activityLabel)) {
    return (
      <div className="flex min-w-0 max-w-full items-center gap-1.5 overflow-hidden text-[13px]">
        {(summaryIcon || showContentIcon) && (
          <span
            aria-hidden="true"
            className="flex size-3.5 shrink-0 items-center justify-center text-foreground-muted transition-colors duration-150 group-hover/tool-group-trigger:text-foreground"
            data-testid="tool-group-content-icon">
            {summaryIcon ?? (
              <ToolGroupContentIcon
                tool={items.at(-1)?.toolResponse.tool}
                toolArguments={items.at(-1)?.toolResponse.arguments}
              />
            )}
          </span>
        )}
        <div className="min-w-0 overflow-hidden">
          <div className="flex items-center text-[13px]">
            <span className="whitespace-nowrap font-normal text-foreground-muted transition-colors duration-150 group-hover/tool-group-trigger:text-foreground">
              {fallbackLabel}
            </span>
          </div>
        </div>
        {elapsedText && (
          <>
            <span aria-hidden="true" className="shrink-0 text-muted-foreground/40">
              ·
            </span>
            <span className="shrink-0 whitespace-nowrap text-muted-foreground/55 transition-colors duration-150 group-hover/tool-group-trigger:text-foreground">
              {elapsedText}
            </span>
          </>
        )}
      </div>
    )
  }

  return <DynamicToolBlockGroupHeaderContent {...props} />
})
ToolBlockGroupHeaderContent.displayName = 'ToolBlockGroupHeaderContent'

// Component for tool list content with auto-scroll
interface ToolBlockGroupContentProps {
  items: ToolRenderItem[]
  scrollRef?: React.RefObject<HTMLDivElement | null>
}

export const ToolBlockGroupContent = React.memo(({ items, scrollRef }: ToolBlockGroupContentProps) => (
  <div ref={scrollRef} className="tool-block-group-content flex w-full flex-col gap-2">
    {items.map((item) => {
      return (
        <div key={item.id} data-block-id={item.id} className="w-full">
          <ErrorBoundary fallbackComponent={BlockErrorFallback}>
            <MessageTools toolResponse={item.toolResponse} />
          </ErrorBoundary>
        </div>
      )
    })}
  </div>
))
ToolBlockGroupContent.displayName = 'ToolBlockGroupContent'

interface ToolBlockGroupProps {
  children?: React.ReactNode
  isLiveProgress?: boolean
  isThinking?: boolean
  items: ToolRenderItem[]
}

const ToolGroupPartsBoundary = React.memo(
  ({ allItemsCompleted, children }: { allItemsCompleted: boolean; children: React.ReactNode }) => {
    const partsMap = allItemsCompleted ? null : React.use(PartsContext)
    return <PartsProvider value={partsMap}>{children}</PartsProvider>
  }
)
ToolGroupPartsBoundary.displayName = 'ToolGroupPartsBoundary'

/** A nested, independently collapsible group of adjacent tool calls. */
export const ToolBlockGroup = React.memo(
  ({ children, isLiveProgress: isLiveProgressProp, isThinking = false, items }: ToolBlockGroupProps) => {
    const { t } = useTranslation()
    const [isExpanded, setIsExpanded] = React.useState(false)
    const { anchorRef, withScrollAnchor } = useScrollAnchor<HTMLDivElement>()
    const requestFollowRecovery = useRequestScrollFollowRecovery(anchorRef)
    const allItemsCompleted = items.every((item) => isToolGroupItemCompleted(item.toolResponse.status))
    const isLiveProgress =
      isLiveProgressProp ?? items.some((item) => !isToolGroupItemCompleted(item.toolResponse.status))

    const disclosure = (
      <div ref={anchorRef} className="group/child-tool-group w-full max-w-full" data-testid="child-tool-group">
        <Accordion
          type="single"
          collapsible
          value={isExpanded ? 'tools' : ''}
          onValueChange={(value) => {
            const nextIsExpanded = value === 'tools'
            if (!nextIsExpanded) requestFollowRecovery()
            withScrollAnchor(() => setIsExpanded(nextIsExpanded), { settleAfterMs: 220 })
          }}>
          <AccordionItem value="tools" className="border-0 first:border-t-0">
            <AccordionTrigger className="group/tool-group-trigger [&>svg]:-rotate-90 h-auto min-h-7 w-fit max-w-full flex-none select-none justify-start gap-1.5 rounded bg-transparent px-0 py-0.5 text-left font-normal shadow-none hover:no-underline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 focus-visible:ring-0 [&>svg]:size-3.5 [&>svg]:opacity-0 [&>svg]:transition-[transform,opacity] hover:[&>svg]:opacity-60 focus-visible:[&>svg]:opacity-60 [&[data-state=open]>svg]:rotate-0 [&[data-state=open]>svg]:opacity-60">
              <div className="min-w-0 overflow-hidden">
                <ToolBlockGroupHeaderContent
                  items={items}
                  activityLabel={isThinking ? t('message.tools.thinkingHeader') : undefined}
                  activityIcon={
                    isThinking ? <Brain aria-hidden="true" className={TOOL_GROUP_ICON_CLASS_NAME} /> : undefined
                  }
                  isLiveProgress={isLiveProgress}
                  semanticToolTitle
                  showContentIcon
                  showLatestWhenComplete
                />
              </div>
            </AccordionTrigger>
            <AccordionContent
              data-testid="child-tool-group-content"
              className="px-0 pt-2 pb-0 text-inherit"
              contentClassName="text-inherit motion-safe:data-[state=open]:[animation-duration:200ms] motion-safe:data-[state=closed]:[animation-duration:160ms] motion-reduce:animate-none">
              {children ?? <ToolBlockGroupContent items={items} />}
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
    )

    return <ToolGroupPartsBoundary allItemsCompleted={allItemsCompleted}>{disclosure}</ToolGroupPartsBoundary>
  }
)
ToolBlockGroup.displayName = 'ToolBlockGroup'
