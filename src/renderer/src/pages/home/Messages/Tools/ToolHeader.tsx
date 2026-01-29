import type { MCPTool, MCPToolResponse, NormalToolResponse } from '@renderer/types'
import type { ToolMessageBlock } from '@renderer/types/newMessage'
import { isToolAutoApproved } from '@renderer/utils/mcp-tools'
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
import type { FC, ReactNode } from 'react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { type ToolStatus, ToolStatusIndicator } from './MessageAgentTools/GenericTools'
import { AgentToolsType } from './MessageAgentTools/types'

export interface ToolHeaderProps {
  block?: ToolMessageBlock

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
  return (
    (args as Record<string, unknown>).description ||
    (args as Record<string, unknown>).file_path ||
    (args as Record<string, unknown>).pattern ||
    (args as Record<string, unknown>).query ||
    (args as Record<string, unknown>).command ||
    (args as Record<string, unknown>).url
  )?.toString()
}

// ============ Styled Components ============

const HeaderContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  padding: 8px 12px;
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: 0.75rem;
  min-width: 0;
`

// Label variant: no border/padding, for use inside Collapse header
const LabelContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 14px;
  min-width: 0;
`

const ToolName = styled(Flex)`
  font-weight: 500;
  color: var(--color-text);
  flex-shrink: 0;

  .tool-icon {
    color: var(--color-primary);
  }

  .name {
    white-space: nowrap;
  }
`

const Description = styled.span`
  color: var(--color-text-2);
  font-weight: 400;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  flex: 1;
  max-width: 300px;
`

const Stats = styled.span`
  color: var(--color-text-2);
  font-weight: 400;
  font-size: 12px;
  white-space: nowrap;
  flex-shrink: 0;
`

const StatusWrapper = styled.div`
  display: flex;
  align-items: center;
  flex-shrink: 0;
  margin-left: auto;
`

// ============ Main Component ============

const ToolHeader: FC<ToolHeaderProps> = ({
  block,
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

  const toolResponse = block?.metadata?.rawMcpToolResponse
  const tool = toolResponse?.tool

  const toolName = propToolName || tool?.name || 'Tool'

  const status = propStatus || (toolResponse?.status as ToolStatus)
  const hasError = propHasError ?? toolResponse?.response?.isError === true

  const description = params ?? getToolDescription(toolResponse)

  const Container = variant === 'standalone' ? HeaderContainer : LabelContainer

  if (block && tool?.type === 'mcp') {
    const mcpTool = tool as MCPTool
    return (
      <Container>
        <ToolName align="center" gap={6}>
          <Wrench size={14} className="tool-icon" />
          <span className="name">
            {mcpTool.serverName} : {mcpTool.name}
          </span>
          {isToolAutoApproved(mcpTool) && (
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
