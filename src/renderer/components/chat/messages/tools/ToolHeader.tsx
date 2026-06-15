import { Flex, Tooltip } from '@cherrystudio/ui'
import type { McpTool, McpToolResponse, NormalToolResponse } from '@renderer/types'
import {
  Bot,
  DoorOpen,
  FileEdit,
  FileSearch,
  FileText,
  FolderSearch,
  Globe,
  ListTodo,
  NotebookPen,
  PencilRuler,
  Search,
  Send,
  ShieldCheck,
  Terminal,
  Wrench
} from 'lucide-react'
import type { ComponentPropsWithoutRef, FC, ReactNode } from 'react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'

import { useOptionalMessageListUi } from '../MessageListProvider'
import { type ToolStatus, ToolStatusIndicator, useIsStreaming } from './agent/GenericTools'
import { AgentToolsType } from './agent/types'

type Translate = (key: string, options?: Record<string, string>) => string
export interface ToolActivity {
  label: string
  description?: string
}

export interface ToolHeaderProps {
  toolResponse?: McpToolResponse | NormalToolResponse

  label?: string
  toolName?: string
  args?: unknown
  icon?: ReactNode
  params?: ReactNode
  stats?: ReactNode

  // Common config
  status?: ToolStatus
  hasError?: boolean
  showStatus?: boolean // default true

  // Style variant
  variant?: 'standalone' | 'collapse-label'
}

/**
 * Per-tool chat-header display: icon + (optional) i18n label key. Table-driven (replaces the
 * former icon/label switches). Tools absent here fall back to a generic wrench icon + the raw
 * tool name.
 */
export const TOOL_HEADER_UI: Record<string, { icon: ReactNode; labelKey?: string }> = {
  [AgentToolsType.Agent]: { icon: <Bot size={14} /> },
  [AgentToolsType.Read]: { icon: <FileText size={14} />, labelKey: 'message.tools.labels.readFile' },
  [AgentToolsType.Task]: { icon: <ListTodo size={14} />, labelKey: 'message.tools.labels.task' },
  [AgentToolsType.TaskCreate]: { icon: <ListTodo size={14} />, labelKey: 'message.tools.labels.taskCreate' },
  [AgentToolsType.TaskGet]: { icon: <ListTodo size={14} />, labelKey: 'message.tools.labels.taskGet' },
  [AgentToolsType.TaskUpdate]: { icon: <ListTodo size={14} />, labelKey: 'message.tools.labels.taskUpdate' },
  [AgentToolsType.TaskList]: { icon: <ListTodo size={14} />, labelKey: 'message.tools.labels.taskList' },
  [AgentToolsType.TaskOutput]: { icon: <ListTodo size={14} />, labelKey: 'message.tools.labels.taskOutput' },
  [AgentToolsType.TaskStop]: { icon: <ListTodo size={14} />, labelKey: 'message.tools.labels.taskStop' },
  [AgentToolsType.Bash]: { icon: <Terminal size={14} />, labelKey: 'message.tools.labels.bash' },
  [AgentToolsType.BashOutput]: { icon: <Terminal size={14} />, labelKey: 'message.tools.labels.bashOutput' },
  [AgentToolsType.Search]: { icon: <Search size={14} />, labelKey: 'message.tools.labels.search' },
  [AgentToolsType.Glob]: { icon: <FolderSearch size={14} />, labelKey: 'message.tools.labels.glob' },
  [AgentToolsType.Grep]: { icon: <FileSearch size={14} />, labelKey: 'message.tools.labels.grep' },
  [AgentToolsType.Write]: { icon: <FileText size={14} />, labelKey: 'message.tools.labels.write' },
  [AgentToolsType.Edit]: { icon: <FileEdit size={14} />, labelKey: 'message.tools.labels.edit' },
  [AgentToolsType.MultiEdit]: { icon: <FileText size={14} />, labelKey: 'message.tools.labels.multiEdit' },
  [AgentToolsType.WebSearch]: { icon: <Globe size={14} />, labelKey: 'message.tools.labels.webSearch' },
  [AgentToolsType.WebFetch]: { icon: <Globe size={14} />, labelKey: 'message.tools.labels.webFetch' },
  [AgentToolsType.NotebookEdit]: { icon: <NotebookPen size={14} />, labelKey: 'message.tools.labels.notebookEdit' },
  [AgentToolsType.TodoWrite]: { icon: <ListTodo size={14} />, labelKey: 'message.tools.labels.todoWrite' },
  [AgentToolsType.ExitPlanMode]: { icon: <DoorOpen size={14} />, labelKey: 'message.tools.labels.exitPlanMode' },
  [AgentToolsType.SendMessage]: { icon: <Send size={14} /> },
  [AgentToolsType.TeamCreate]: { icon: <Bot size={14} /> },
  [AgentToolsType.TeamDelete]: { icon: <Bot size={14} /> },
  [AgentToolsType.EnterWorktree]: { icon: <DoorOpen size={14} /> },
  [AgentToolsType.ExitWorktree]: { icon: <DoorOpen size={14} /> },
  [AgentToolsType.Skill]: { icon: <PencilRuler size={14} />, labelKey: 'message.tools.labels.skill' }
}

const getAgentToolIcon = (toolName: string): ReactNode => TOOL_HEADER_UI[toolName]?.icon ?? <Wrench size={14} />

const getAgentToolLabel = (toolName: string, t: Translate): string => {
  const labelKey = TOOL_HEADER_UI[toolName]?.labelKey
  return labelKey ? t(labelKey) : toolName
}

function getStringArg(args: unknown, key: string): string | undefined {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return undefined
  const value = (args as Record<string, unknown>)[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function getStringInput(args: unknown): string | undefined {
  return typeof args === 'string' && args.trim() ? args.trim() : undefined
}

function getTaskIdTarget(args: unknown, t: Translate): string | undefined {
  const taskId = getStringArg(args, 'taskId') ?? getStringArg(args, 'task_id') ?? getStringArg(args, 'shell_id')
  return taskId ? t('message.tools.activity.taskId', { id: taskId }) : undefined
}

function getFileName(filePath: string | undefined): string | undefined {
  if (!filePath) return undefined
  return filePath.split('/').filter(Boolean).pop() ?? filePath
}

function getReadableUrlTarget(url: string | undefined, t: Translate): string | undefined {
  if (!url) return undefined
  try {
    const parsed = new URL(url)
    return parsed.hostname || t('message.tools.activity.webPage')
  } catch {
    return t('message.tools.activity.webPage')
  }
}

function getReadableFileGroup(text: string | undefined, t: Translate): string | undefined {
  if (!text) return undefined
  const value = text.toLowerCase()
  if (
    value.includes('readme') ||
    value.includes('package.json') ||
    value.includes('go.mod') ||
    value.includes('cargo.toml') ||
    value.includes('tsconfig') ||
    value.includes('.config.')
  ) {
    return t('message.tools.activity.configFiles')
  }
  if (value.includes('*.md') || value.includes('.md') || value.includes('markdown') || value.includes('md files')) {
    return t('message.tools.activity.documentFiles')
  }
  if (/\.(png|jpe?g|gif|webp|svg|ico)\b/.test(value)) {
    return t('message.tools.activity.imageFiles')
  }
  if (value.includes('locales') || value.includes('i18n')) {
    return t('message.tools.activity.translationFiles')
  }
  if (/\.(ts|tsx|js|jsx|json|css|go|rs|py|java|kt|swift|cpp|c|h)\b/.test(value)) {
    return t('message.tools.activity.codeFiles')
  }
  return undefined
}

function getReadablePathTarget(filePath: string | undefined, t: Translate): string | undefined {
  return getFileName(filePath) ?? getReadableFileGroup(filePath, t)
}

const SEARCH_PATTERN_META_RE = /[\\^$.*+?()[\]{}|]/

function getReadableSearchTarget(value: string | undefined, t: Translate): string {
  const text = value?.trim()
  if (!text) return t('message.tools.activity.relatedContent')
  const fileGroup = getReadableFileGroup(text, t)
  if (fileGroup) return fileGroup
  if (SEARCH_PATTERN_META_RE.test(text) || text.length > 48) return t('message.tools.activity.relatedContent')
  return text
}

function getFirstShellWord(command: string | undefined): string | undefined {
  const firstWord = command?.trim().match(/^[\w./-]+/)?.[0]
  if (!firstWord) return undefined
  return firstWord.split('/').pop()
}

function getShellWords(command: string | undefined): string[] {
  return (
    command
      ?.match(/"[^"]+"|'[^']+'|\S+/g)
      ?.map((word) => word.replace(/^['"]|['"]$/g, ''))
      .filter((word) => word && !word.startsWith('-') && word !== '&&' && word !== '||') ?? []
  )
}

function getCommandPathTarget(command: string | undefined, t: Translate): string {
  const words = getShellWords(command)
  const firstPath = words.slice(1).find((word) => /[/.]/.test(word) && !/^https?:\/\//i.test(word))
  return getReadablePathTarget(firstPath, t) ?? t('message.tools.activity.file')
}

function getPackageTarget(command: string | undefined, t: Translate): string {
  if (!command) return t('message.tools.activity.projectDependencies')
  const match = command.match(
    /\b(?:npm|pnpm|yarn|bun|pip3?|poetry|uv|cargo|go|brew)\s+(?:install|add|get)\s+([^;&|]+)/i
  )
  if (!match?.[1]) return t('message.tools.activity.projectDependencies')
  const packages = match[1]
    .split(/\s+/)
    .filter((value) => value && !value.startsWith('-'))
    .slice(0, 3)
    .join(' ')
  return packages || t('message.tools.activity.projectDependencies')
}

function getDownloadedTarget(command: string | undefined, t: Translate): string {
  const url = command?.match(/https?:\/\/[^\s'")]+/i)?.[0]
  if (!url) return t('message.tools.activity.file')
  try {
    const parsed = new URL(url)
    return parsed.pathname.split('/').filter(Boolean).pop() || parsed.hostname
  } catch {
    return t('message.tools.activity.file')
  }
}

function getActivityLabels(active: boolean, t: Translate) {
  return active
    ? {
        build: t('message.tools.activity.building'),
        check: t('message.tools.activity.checking'),
        copy: t('message.tools.activity.copying'),
        create: t('message.tools.activity.creating'),
        delete: t('message.tools.activity.deleting'),
        download: t('message.tools.activity.downloading'),
        execute: t('message.tools.activity.executingCommand'),
        extract: t('message.tools.activity.extracting'),
        handle: t('message.tools.activity.handling'),
        install: t('message.tools.activity.installing'),
        modify: t('message.tools.activity.modifying'),
        move: t('message.tools.activity.moving'),
        open: t('message.tools.activity.opening'),
        search: t('message.tools.activity.searching'),
        switch: t('message.tools.activity.switching'),
        sync: t('message.tools.activity.syncing'),
        upload: t('message.tools.activity.uploading'),
        view: t('message.tools.activity.viewing'),
        write: t('message.tools.activity.writing')
      }
    : {
        build: t('message.tools.activity.build'),
        check: t('message.tools.activity.check'),
        copy: t('message.tools.activity.copy'),
        create: t('message.tools.activity.create'),
        delete: t('message.tools.activity.delete'),
        download: t('message.tools.activity.download'),
        execute: t('message.tools.activity.executeCommand'),
        extract: t('message.tools.activity.extract'),
        handle: t('message.tools.activity.handle'),
        install: t('message.tools.activity.install'),
        modify: t('message.tools.activity.modify'),
        move: t('message.tools.activity.move'),
        open: t('message.tools.activity.open'),
        search: t('message.tools.activity.search'),
        switch: t('message.tools.activity.switch'),
        sync: t('message.tools.activity.sync'),
        upload: t('message.tools.activity.upload'),
        view: t('message.tools.activity.view'),
        write: t('message.tools.activity.write')
      }
}

function getCommandActivity(args: unknown, active: boolean, t: Translate): ToolActivity {
  const description = getStringArg(args, 'description')
  const command = getStringArg(args, 'command')
  const text = `${description ?? ''} ${command ?? ''}`.toLowerCase()
  const labels = getActivityLabels(active, t)

  if (/\b(?:npm|pnpm|yarn|bun|pip3?|poetry|uv|cargo|go|brew)\s+(?:install|add|get)\b/.test(text)) {
    return { label: labels.install, description: getPackageTarget(command, t) }
  }
  if (/\b(?:npm|pnpm|yarn|bun|pip3?|poetry|uv|cargo|brew)\s+(?:remove|uninstall|rm)\b/.test(text)) {
    return { label: labels.delete, description: t('message.tools.activity.projectDependencies') }
  }
  if (/\b(?:curl|wget)\b/.test(text)) {
    return { label: labels.download, description: getDownloadedTarget(command, t) }
  }
  if (/\bgit\s+clone\b/.test(text))
    return { label: labels.download, description: t('message.tools.activity.repository') }
  if (/\bgit\s+(?:pull|fetch|rebase|merge)\b/.test(text)) {
    return { label: labels.sync, description: t('message.tools.activity.repository') }
  }
  if (/\bgit\s+(?:checkout|switch|branch)\b/.test(text)) {
    return { label: labels.switch, description: t('message.tools.activity.branch') }
  }
  if (/\bgit\s+(?:status|diff|log|show|blame)\b/.test(text)) {
    return { label: labels.view, description: t('message.tools.activity.projectChanges') }
  }
  if (/\bgit\s+commit\b/.test(text))
    return { label: labels.write, description: t('message.tools.activity.projectChanges') }
  if (/\bgit\s+push\b/.test(text))
    return { label: labels.upload, description: t('message.tools.activity.projectChanges') }
  if (/\bgh\s+(?:pr|issue|run|workflow|repo)\b/.test(text)) {
    return { label: labels.view, description: t('message.tools.activity.codeHostInfo') }
  }
  if (/\b(?:cp|rsync)\b/.test(text)) return { label: labels.copy, description: getCommandPathTarget(command, t) }
  if (/\bmv\b/.test(text)) return { label: labels.move, description: getCommandPathTarget(command, t) }
  if (/\b(?:rm|rmdir)\b/.test(text)) return { label: labels.delete, description: getCommandPathTarget(command, t) }
  if (/\bmkdir\b/.test(text)) return { label: labels.create, description: t('message.tools.activity.folder') }
  if (/\btouch\b/.test(text)) return { label: labels.create, description: getCommandPathTarget(command, t) }
  if (/\b(?:unzip|tar)\b/.test(text)) return { label: labels.extract, description: t('message.tools.activity.archive') }
  if (/\b(?:open|xdg-open|start)\b/.test(text))
    return { label: labels.open, description: getCommandPathTarget(command, t) }
  if (
    /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:build|compile|package)\b|\b(?:vite|tsup|rollup|webpack|electron-builder)\b/.test(
      text
    )
  ) {
    return { label: labels.build, description: t('message.tools.activity.projectFiles') }
  }
  if (
    /(\btest\b|\blint\b|\btypecheck\b|\bcheck\b|\bvitest\b|\bjest\b|\bplaywright\b|\btsc\b|\beslint\b|\bbiome\b)/.test(
      text
    )
  ) {
    return { label: labels.check, description: t('message.tools.activity.projectChecks') }
  }
  if (/(\brg\b|\bgrep\b|\bag\b|\bfd\b|\bfind\b|\blocate\b)/.test(text)) {
    return { label: labels.search, description: getReadableSearchTarget(description ?? command, t) }
  }
  if (/\bpwd\b/.test(text)) return { label: labels.view, description: t('message.tools.activity.currentFolder') }
  if (/(\bcat\b|\bhead\b|\btail\b|\bless\b|\bmore\b|\bsed\s+-n\b|\bawk\b|\bwc\b|\bstat\b|\bdu\b)/.test(text)) {
    return { label: labels.view, description: getCommandPathTarget(command, t) }
  }
  const fileGroup = getReadableFileGroup(text, t)
  if (fileGroup) return { label: labels.search, description: fileGroup }
  if (text.includes('root directory'))
    return { label: labels.view, description: t('message.tools.activity.projectRootFiles') }
  if (text.includes('project directory'))
    return { label: labels.view, description: t('message.tools.activity.projectFiles') }
  if (/(\bls\b|\btree\b|\blist\b)/.test(text))
    return { label: labels.view, description: t('message.tools.activity.fileList') }

  const shellWord = getFirstShellWord(command)
  return {
    label: labels.execute,
    description: shellWord
      ? t('message.tools.activity.commandName', { name: shellWord })
      : t('message.tools.activity.projectTask')
  }
}

export function getReadableToolActivity(
  toolName: string,
  args: unknown,
  active: boolean,
  t: Translate
): ToolActivity | undefined {
  const labels = getActivityLabels(active, t)
  const searchText = getStringInput(args) ?? getStringArg(args, 'pattern') ?? getStringArg(args, 'query')

  switch (toolName) {
    case AgentToolsType.Agent:
    case AgentToolsType.Task:
      return {
        label: labels.handle,
        description:
          getStringArg(args, 'description') ?? getStringArg(args, 'prompt') ?? t('message.tools.activity.assistantTask')
      }
    case AgentToolsType.TaskCreate:
      return {
        label: t('message.tools.labels.taskCreate'),
        description:
          getStringArg(args, 'subject') ?? getStringArg(args, 'description') ?? t('message.tools.activity.taskList')
      }
    case AgentToolsType.TaskGet:
      return {
        label: t('message.tools.labels.taskGet'),
        description: getTaskIdTarget(args, t) ?? t('message.tools.activity.taskList')
      }
    case AgentToolsType.TaskList:
      return { label: t('message.tools.labels.taskList'), description: t('message.tools.activity.taskList') }
    case AgentToolsType.TaskOutput:
      return {
        label: t('message.tools.labels.taskOutput'),
        description: getTaskIdTarget(args, t) ?? t('message.tools.activity.taskList')
      }
    case AgentToolsType.TaskUpdate:
      return {
        label: t('message.tools.labels.taskUpdate'),
        description:
          getStringArg(args, 'subject') ??
          getStringArg(args, 'description') ??
          getTaskIdTarget(args, t) ??
          t('message.tools.activity.taskList')
      }
    case AgentToolsType.TaskStop:
      return {
        label: t('message.tools.labels.taskStop'),
        description: getTaskIdTarget(args, t) ?? t('message.tools.activity.taskList')
      }
    case AgentToolsType.Bash:
    case AgentToolsType.BashOutput:
      return getCommandActivity(args, active, t)
    case AgentToolsType.Glob:
      return {
        label: labels.search,
        description: getReadableFileGroup(getStringArg(args, 'pattern'), t) ?? t('message.tools.activity.matchingFiles')
      }
    case AgentToolsType.Grep:
    case AgentToolsType.Search:
      return { label: labels.search, description: getReadableSearchTarget(searchText, t) }
    case AgentToolsType.Read:
      return { label: labels.view, description: getReadablePathTarget(getStringArg(args, 'file_path'), t) }
    case AgentToolsType.Write:
      return { label: labels.write, description: getReadablePathTarget(getStringArg(args, 'file_path'), t) }
    case AgentToolsType.Edit:
    case AgentToolsType.MultiEdit:
    case AgentToolsType.NotebookEdit:
      return {
        label: labels.modify,
        description: getReadablePathTarget(getStringArg(args, 'file_path') ?? getStringArg(args, 'notebook_path'), t)
      }
    case AgentToolsType.WebSearch:
      return { label: labels.search, description: getStringArg(args, 'query') ?? t('message.tools.activity.webSearch') }
    case AgentToolsType.WebFetch:
      return {
        label: labels.view,
        description: getReadableUrlTarget(getStringArg(args, 'url'), t) ?? t('message.tools.activity.webPage')
      }
    case AgentToolsType.TodoWrite:
      return { label: labels.modify, description: t('message.tools.activity.taskList') }
    case AgentToolsType.Skill:
      return {
        label: labels.handle,
        description: getStringArg(args, 'skill') ?? t('message.tools.activity.assistantTask')
      }
    case AgentToolsType.ToolSearch:
      return {
        label: labels.search,
        description: getStringArg(args, 'query') ?? t('message.tools.activity.availableFeatures')
      }
    case AgentToolsType.ListMcpResources:
    case AgentToolsType.ReadMcpResource:
      return { label: labels.view, description: t('message.tools.activity.availableResources') }
    case AgentToolsType.EnterWorktree:
    case AgentToolsType.ExitWorktree:
      return { label: labels.switch, description: t('message.tools.activity.workspace') }
    case AgentToolsType.ExitPlanMode:
      return { label: labels.write, description: t('message.tools.activity.plan') }
    default:
      return undefined
  }
}

export function getReadableToolDescription(toolName: string, args: unknown, t: Translate): string | undefined {
  return getReadableToolActivity(toolName, args, false, t)?.description
}

function isActiveStatus(status: ToolStatus | undefined): boolean {
  return status === 'pending' || status === 'invoking' || status === 'streaming' || status === 'waiting'
}

const getToolDescription = (toolName: string, args: unknown, t: Translate): string | undefined => {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return undefined

  const readableDescription = getReadableToolDescription(toolName, args, t)
  if (readableDescription) return readableDescription

  // Common description fields
  const argsRecord = args as Record<string, unknown>
  return (
    argsRecord.description ||
    argsRecord.file_path ||
    argsRecord.pattern ||
    argsRecord.query ||
    argsRecord.command ||
    argsRecord.url
  )?.toString()
}

const HeaderContainer = ({ className, ...props }: ComponentPropsWithoutRef<'div'>) => (
  <div
    className={[
      'flex min-w-0 items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-[13px]',
      className
    ]
      .filter(Boolean)
      .join(' ')}
    {...props}
  />
)

// Label variant: no border/padding, for use inside Collapse header
const LabelContainer = ({ className, ...props }: ComponentPropsWithoutRef<'div'>) => (
  <div
    className={['flex min-w-0 max-w-full items-center gap-1 overflow-hidden text-[13px] leading-5', className]
      .filter(Boolean)
      .join(' ')}
    {...props}
  />
)

const ToolName = ({ className, ...props }: ComponentPropsWithoutRef<typeof Flex>) => (
  <Flex
    className={['min-w-0 max-w-full shrink items-center overflow-hidden', className].filter(Boolean).join(' ')}
    {...props}
  />
)

const Description = ({ className, ...props }: ComponentPropsWithoutRef<'span'>) => (
  <span
    className={[
      'inline-block min-w-0 max-w-full shrink truncate font-normal text-[13px] text-foreground-secondary',
      className
    ]
      .filter(Boolean)
      .join(' ')}
    {...props}
  />
)

const Stats = ({ className, ...props }: ComponentPropsWithoutRef<'span'>) => (
  <span
    className={['shrink-0 whitespace-nowrap font-normal text-[13px] text-foreground-secondary', className]
      .filter(Boolean)
      .join(' ')}
    {...props}
  />
)

const StatusWrapper = ({ className, ...props }: ComponentPropsWithoutRef<'div'>) => (
  <div className={['ml-auto flex shrink-0 items-center', className].filter(Boolean).join(' ')} {...props} />
)

function getToolNameClassName(variant: ToolHeaderProps['variant']): string {
  return [
    'items-center gap-1.5',
    variant === 'collapse-label' && 'font-normal text-foreground-secondary [&_.tool-icon]:text-foreground-muted',
    variant === 'standalone' && 'font-medium text-foreground [&_.tool-icon]:text-(--color-primary)'
  ]
    .filter(Boolean)
    .join(' ')
}

function getToolIconClassName(isIconBreathing: boolean): string {
  return ['tool-icon inline-flex shrink-0 items-center', isIconBreathing && 'animate-pulse'].filter(Boolean).join(' ')
}

// ============ MCP Tool sub-renderer ============

interface McpToolHeaderProps {
  tool: McpTool
  description?: ReactNode
  stats?: ReactNode
  showStatus: boolean
  status?: ToolStatus
  hasError: boolean
  Container: typeof HeaderContainer
  variant: ToolHeaderProps['variant']
}

const McpToolHeader: FC<McpToolHeaderProps> = ({
  tool,
  description,
  stats,
  showStatus,
  status,
  hasError,
  Container,
  variant
}) => {
  const { t } = useTranslation()
  const { isToolAutoApproved } = useOptionalMessageListUi() ?? {}
  const autoApproved = isToolAutoApproved?.(tool) ?? false
  const isIconBreathing = variant === 'collapse-label' && isActiveStatus(status)
  return (
    <Container>
      <ToolName className={getToolNameClassName(variant)}>
        <span className={getToolIconClassName(isIconBreathing)}>
          <Wrench size={14} />
        </span>
        <span className="name min-w-0 max-w-full truncate">
          {tool.serverName} : {tool.name}
        </span>
        {autoApproved && (
          <Tooltip content={t('message.tools.autoApproveEnabled')}>
            <ShieldCheck size={14} color="var(--color-primary)" />
          </Tooltip>
        )}
      </ToolName>
      {description && <Description>{description}</Description>}
      {stats && <Stats>{stats}</Stats>}
      {showStatus && status && (
        <StatusWrapper>
          <ToolStatusIndicator status={status} hasError={hasError} />
        </StatusWrapper>
      )}
    </Container>
  )
}

// ============ Main Component ============

const ToolHeader: FC<ToolHeaderProps> = ({
  toolResponse,
  label: propLabel,
  toolName: propToolName,
  args: propArgs,
  icon: propIcon,
  params,
  stats,
  status: propStatus,
  hasError: propHasError,
  showStatus = true,
  variant = 'standalone'
}) => {
  const { t } = useTranslation()
  const isStreaming = useIsStreaming()

  const tool = toolResponse?.tool

  const toolName = propToolName || tool?.name || 'Tool'

  const status = propStatus || (toolResponse?.status as ToolStatus)
  const hasError = propHasError ?? toolResponse?.response?.isError === true
  const args = toolResponse?.arguments ?? propArgs
  const activity = getReadableToolActivity(toolName, args, isStreaming || isActiveStatus(status), t)
  const displayLabel = propLabel ?? activity?.label ?? getAgentToolLabel(toolName, t)
  const description = params ?? activity?.description ?? getToolDescription(toolName, args, t)
  const isIconBreathing = variant === 'collapse-label' && isActiveStatus(status)

  const Container = variant === 'standalone' ? HeaderContainer : LabelContainer

  if (tool?.type === 'mcp') {
    return (
      <McpToolHeader
        tool={tool as McpTool}
        description={description}
        stats={stats}
        showStatus={showStatus}
        status={status}
        hasError={hasError}
        Container={Container}
        variant={variant}
      />
    )
  }

  return (
    <Container>
      <ToolName className={getToolNameClassName(variant)}>
        <span className={getToolIconClassName(isIconBreathing)}>{propIcon || getAgentToolIcon(toolName)}</span>
        <span className="name min-w-0 max-w-full truncate">{displayLabel}</span>
      </ToolName>
      {description && <Description>{description}</Description>}
      {stats && <Stats>{stats}</Stats>}
      {showStatus && status && (
        <StatusWrapper>
          <ToolStatusIndicator status={status} hasError={hasError} />
        </StatusWrapper>
      )}
    </Container>
  )
}

export default memo(ToolHeader)
