import { useIsToolAutoApproved } from '@renderer/hooks/useMCPServers'
import type { MCPTool, MCPToolResponse, NormalToolResponse } from '@renderer/types'
import { Flex, Tooltip } from 'antd'
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
  ShieldCheck,
  Terminal,
  Wrench
} from 'lucide-react'
import type { ComponentPropsWithoutRef, FC, ReactNode } from 'react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'

import { type ToolStatus, ToolStatusIndicator } from './agent/GenericTools'
import { AgentToolsType } from './agent/types'

export interface ToolHeaderProps {
  toolResponse?: MCPToolResponse | NormalToolResponse

  toolName?: string
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

const getAgentToolIcon = (toolName: string): ReactNode => {
  switch (toolName) {
    case AgentToolsType.Read:
      return <FileText size={14} />
    case AgentToolsType.Task:
      return <Bot size={14} />
    case AgentToolsType.Bash:
    case AgentToolsType.BashOutput:
      return <Terminal size={14} />
    case AgentToolsType.Search:
      return <Search size={14} />
    case AgentToolsType.Glob:
      return <FolderSearch size={14} />
    case AgentToolsType.Grep:
      return <FileSearch size={14} />
    case AgentToolsType.Write:
      return <FileText size={14} />
    case AgentToolsType.Edit:
      return <FileEdit size={14} />
    case AgentToolsType.MultiEdit:
      return <FileText size={14} />
    case AgentToolsType.WebSearch:
    case AgentToolsType.WebFetch:
      return <Globe size={14} />
    case AgentToolsType.NotebookEdit:
      return <NotebookPen size={14} />
    case AgentToolsType.TodoWrite:
      return <ListTodo size={14} />
    case AgentToolsType.ExitPlanMode:
      return <DoorOpen size={14} />
    case AgentToolsType.Skill:
      return <PencilRuler size={14} />
    default:
      return <Wrench size={14} />
  }
}

const getAgentToolLabel = (toolName: string, t: (key: string) => string): string => {
  switch (toolName) {
    case AgentToolsType.Read:
      return t('message.tools.labels.readFile')
    case AgentToolsType.Task:
      return t('message.tools.labels.task')
    case AgentToolsType.Bash:
      return t('message.tools.labels.bash')
    case AgentToolsType.BashOutput:
      return t('message.tools.labels.bashOutput')
    case AgentToolsType.Search:
      return t('message.tools.labels.search')
    case AgentToolsType.Glob:
      return t('message.tools.labels.glob')
    case AgentToolsType.Grep:
      return t('message.tools.labels.grep')
    case AgentToolsType.Write:
      return t('message.tools.labels.write')
    case AgentToolsType.Edit:
      return t('message.tools.labels.edit')
    case AgentToolsType.MultiEdit:
      return t('message.tools.labels.multiEdit')
    case AgentToolsType.WebSearch:
      return t('message.tools.labels.webSearch')
    case AgentToolsType.WebFetch:
      return t('message.tools.labels.webFetch')
    case AgentToolsType.NotebookEdit:
      return t('message.tools.labels.notebookEdit')
    case AgentToolsType.TodoWrite:
      return t('message.tools.labels.todoWrite')
    case AgentToolsType.ExitPlanMode:
      return t('message.tools.labels.exitPlanMode')
    case AgentToolsType.Skill:
      return t('message.tools.labels.skill')
    default:
      return toolName
  }
}

const getToolDescription = (toolResponse?: MCPToolResponse | NormalToolResponse): string | undefined => {
  if (!toolResponse) return undefined
  const args = toolResponse.arguments
  if (!args || typeof args !== 'object' || Array.isArray(args)) return undefined

  // Common description fields
  return (args.description || args.file_path || args.pattern || args.query || args.command || args.url)?.toString()
}

const HeaderContainer = ({ className, ...props }: ComponentPropsWithoutRef<'div'>) => (
  <div
    className={[
      'flex min-w-0 items-center gap-2 rounded-xl border border-(--color-border) bg-(--color-background) px-3 py-2 text-[13px]',
      className
    ]
      .filter(Boolean)
      .join(' ')}
    {...props}
  />
)

// Label variant: no border/padding, for use inside Collapse header
const LabelContainer = ({ className, ...props }: ComponentPropsWithoutRef<'div'>) => (
  <div className={['flex min-w-0 items-center gap-1 text-sm', className].filter(Boolean).join(' ')} {...props} />
)

const ToolName = ({ className, ...props }: ComponentPropsWithoutRef<typeof Flex>) => (
  <Flex
    className={[
      'shrink-0 font-medium text-(--color-text) [&_.name]:whitespace-nowrap [&_.tool-icon]:text-(--color-primary)',
      className
    ]
      .filter(Boolean)
      .join(' ')}
    {...props}
  />
)

const Description = ({ className, ...props }: ComponentPropsWithoutRef<'span'>) => (
  <span
    className={[
      'inline-flex min-w-0 max-w-[300px] flex-1 items-center overflow-hidden text-ellipsis whitespace-nowrap font-normal text-(--color-text-2) text-[13px]',
      className
    ]
      .filter(Boolean)
      .join(' ')}
    {...props}
  />
)

const Stats = ({ className, ...props }: ComponentPropsWithoutRef<'span'>) => (
  <span
    className={['shrink-0 whitespace-nowrap font-normal text-(--color-text-2) text-xs', className]
      .filter(Boolean)
      .join(' ')}
    {...props}
  />
)

const StatusWrapper = ({ className, ...props }: ComponentPropsWithoutRef<'div'>) => (
  <div className={['ml-auto flex shrink-0 items-center', className].filter(Boolean).join(' ')} {...props} />
)

// ============ MCP Tool sub-renderer ============

interface McpToolHeaderProps {
  tool: MCPTool
  description?: ReactNode
  stats?: ReactNode
  showStatus: boolean
  status?: ToolStatus
  hasError: boolean
  Container: typeof HeaderContainer
}

const McpToolHeader: FC<McpToolHeaderProps> = ({
  tool,
  description,
  stats,
  showStatus,
  status,
  hasError,
  Container
}) => {
  const { t } = useTranslation()
  const autoApproved = useIsToolAutoApproved(tool)
  return (
    <Container>
      <ToolName align="center" gap={6}>
        <Wrench size={14} className="tool-icon" />
        <span className="name">
          {tool.serverName} : {tool.name}
        </span>
        {autoApproved && (
          <Tooltip title={t('message.tools.autoApproveEnabled')} mouseLeaveDelay={0}>
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
  toolName: propToolName,
  icon: propIcon,
  params,
  stats,
  status: propStatus,
  hasError: propHasError,
  showStatus = true,
  variant = 'standalone'
}) => {
  const { t } = useTranslation()

  const tool = toolResponse?.tool

  const toolName = propToolName || tool?.name || 'Tool'

  const status = propStatus || (toolResponse?.status as ToolStatus)
  const hasError = propHasError ?? toolResponse?.response?.isError === true

  const description = params ?? getToolDescription(toolResponse)

  const Container = variant === 'standalone' ? HeaderContainer : LabelContainer

  if (tool?.type === 'mcp') {
    return (
      <McpToolHeader
        tool={tool as MCPTool}
        description={description}
        stats={stats}
        showStatus={showStatus}
        status={status}
        hasError={hasError}
        Container={Container}
      />
    )
  }

  return (
    <Container>
      <ToolName align="center" gap={6}>
        <span className="tool-icon">{propIcon || getAgentToolIcon(toolName)}</span>
        <span className="name">{getAgentToolLabel(toolName, t)}</span>
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
