import { loggerService } from '@logger'
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { CopyIcon, LoadingIcon } from '@renderer/components/Icons'
import { useCodeStyle } from '@renderer/context/CodeStyleProvider'
import { useMCPServers } from '@renderer/hooks/useMCPServers'
import { useSettings } from '@renderer/hooks/useSettings'
import { useTimer } from '@renderer/hooks/useTimer'
import type { MCPToolResponse } from '@renderer/types'
import type { ToolMessageBlock } from '@renderer/types/newMessage'
import { isToolAutoApproved } from '@renderer/utils/mcp-tools'
import { cancelToolAction, confirmToolAction } from '@renderer/utils/userConfirmation'
import type { MCPProgressEvent } from '@shared/config/types'
import { IpcChannel } from '@shared/IpcChannel'
import { Button, Collapse, ConfigProvider, Dropdown, Flex, message as antdMessage, Progress, Tooltip } from 'antd'
import { message } from 'antd'
import {
  Check,
  ChevronDown,
  ChevronRight,
  CirclePlay,
  CircleX,
  PauseCircle,
  ShieldCheck,
  TriangleAlert,
  X
} from 'lucide-react'
import { parse as parsePartialJson } from 'partial-json'
import type { FC } from 'react'
import { memo, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SkeletonSpan } from './MessageAgentTools/GenericTools'
import {
  ArgKey,
  ArgsSection,
  ArgsSectionTitle,
  ArgsTable,
  ArgValue,
  formatArgValue,
  ResponseSection
} from './shared/ArgsTable'

interface Props {
  block: ToolMessageBlock
}

const logger = loggerService.withContext('MessageTools')

const COUNTDOWN_TIME = 30

const MessageMcpTool: FC<Props> = ({ block }) => {
  const [activeKeys, setActiveKeys] = useState<string[]>([])
  const [copiedMap, setCopiedMap] = useState<Record<string, boolean>>({})
  const [countdown, setCountdown] = useState<number>(COUNTDOWN_TIME)
  const { t } = useTranslation()
  const { messageFont, fontSize } = useSettings()
  const { mcpServers, updateMCPServer } = useMCPServers()
  const [progress, setProgress] = useState<number>(0)
  const { setTimeoutTimer, clearTimeoutTimer } = useTimer()

  const toolResponse = block.metadata?.rawMcpToolResponse as MCPToolResponse

  const { id, tool, status, response, partialArguments } = toolResponse as MCPToolResponse
  const isPending = status === 'pending'
  const isDone = status === 'done'
  const isError = status === 'error'
  const isStreaming = status === 'streaming'

  const isAutoApproved = useMemo(
    () =>
      isToolAutoApproved(
        tool,
        mcpServers.find((s) => s.id === tool.serverId)
      ),
    [tool, mcpServers]
  )

  // 增加本地状态来跟踪用户确认
  const [isConfirmed, setIsConfirmed] = useState(isAutoApproved)

  // 判断不同的UI状态
  const isWaitingConfirmation = isPending && !isAutoApproved && !isConfirmed
  const isExecuting = isPending && (isAutoApproved || isConfirmed)

  useEffect(() => {
    if (!isWaitingConfirmation) return

    if (countdown > 0) {
      setTimeoutTimer(
        `countdown-${id}`,
        () => {
          logger.debug(`countdown: ${countdown}`)
          setCountdown((prev) => prev - 1)
        },
        1000
      )
    } else if (countdown === 0) {
      setIsConfirmed(true)
      confirmToolAction(id)
    }

    return () => clearTimeoutTimer(`countdown-${id}`)
  }, [countdown, id, isWaitingConfirmation, setTimeoutTimer, clearTimeoutTimer])

  useEffect(() => {
    const removeListener = window.electron.ipcRenderer.on(
      IpcChannel.Mcp_Progress,
      (_event: Electron.IpcRendererEvent, data: MCPProgressEvent) => {
        // Only update progress if this event is for our specific tool call
        if (data.callId === id) {
          setProgress(data.progress)
        }
      }
    )
    return () => {
      setProgress(0)
      removeListener()
    }
  }, [id])

  // Auto-expand when streaming, auto-collapse when done
  useEffect(() => {
    if (isStreaming) {
      // Expand when streaming starts
      setActiveKeys((prev) => (prev.includes(id) ? prev : [...prev, id]))
    } else if (isDone || isError) {
      // Collapse when streaming ends
      setActiveKeys((prev) => prev.filter((key) => key !== id))
    }
  }, [isStreaming, isDone, isError, id])

  const cancelCountdown = () => {
    clearTimeoutTimer(`countdown-${id}`)
  }

  if (!toolResponse) {
    return null
  }

  const copyContent = (content: string, toolId: string) => {
    navigator.clipboard.writeText(content)
    antdMessage.success({ content: t('message.copied'), key: 'copy-message' })
    setCopiedMap((prev) => ({ ...prev, [toolId]: true }))
    setTimeoutTimer('copyContent', () => setCopiedMap((prev) => ({ ...prev, [toolId]: false })), 2000)
  }

  const handleCollapseChange = (keys: string | string[]) => {
    setActiveKeys(Array.isArray(keys) ? keys : [keys])
  }

  const handleConfirmTool = () => {
    cancelCountdown()
    setIsConfirmed(true)
    confirmToolAction(id)
  }

  const handleCancelTool = () => {
    cancelCountdown()
    cancelToolAction(id)
  }

  const handleAbortTool = async () => {
    if (toolResponse?.id) {
      try {
        const success = await window.api.mcp.abortTool(toolResponse.id)
        if (success) {
          window.toast.success(t('message.tools.aborted'))
        } else {
          message.error({ content: t('message.tools.abort_failed'), key: 'abort-tool' })
        }
      } catch (error) {
        logger.error('Failed to abort tool:', error as Error)
        message.error({ content: t('message.tools.abort_failed'), key: 'abort-tool' })
      }
    }
  }

  const handleAutoApprove = async () => {
    cancelCountdown()

    if (!tool || !tool.name) {
      return
    }

    const server = mcpServers.find((s) => s.id === tool.serverId)
    if (!server) {
      return
    }

    let disabledAutoApproveTools = [...(server.disabledAutoApproveTools || [])]

    // Remove tool from disabledAutoApproveTools to enable auto-approve
    disabledAutoApproveTools = disabledAutoApproveTools.filter((name) => name !== tool.name)

    const updatedServer = {
      ...server,
      disabledAutoApproveTools
    }

    updateMCPServer(updatedServer)

    // Also confirm the current tool
    setIsConfirmed(true)
    confirmToolAction(id)

    window.toast.success(t('message.tools.autoApproveEnabled', 'Auto-approve enabled for this tool'))
  }

  const renderStatusIndicator = (status: string, hasError: boolean) => {
    let label = ''
    let icon: React.ReactNode | null = null

    if (status === 'streaming') {
      label = t('message.tools.streaming', 'Streaming')
      icon = <LoadingIcon style={{ marginLeft: 6 }} />
    } else if (status === 'pending') {
      if (isWaitingConfirmation) {
        label = t('message.tools.pending', 'Awaiting Approval')
        icon = <LoadingIcon style={{ marginLeft: 6, color: 'var(--status-color-warning)' }} />
      } else if (isExecuting) {
        label = t('message.tools.invoking')
        icon = <LoadingIcon style={{ marginLeft: 6 }} />
      }
    } else if (status === 'cancelled') {
      label = t('message.tools.cancelled')
      icon = <X size={13} style={{ marginLeft: 6 }} className="lucide-custom" />
    } else if (status === 'done') {
      if (hasError) {
        label = t('message.tools.error')
        icon = <TriangleAlert size={13} style={{ marginLeft: 6 }} className="lucide-custom" />
      } else {
        label = t('message.tools.completed')
        icon = <Check size={13} style={{ marginLeft: 6 }} className="lucide-custom" />
      }
    } else if (status === 'error') {
      label = t('message.tools.error')
      icon = <TriangleAlert size={13} style={{ marginLeft: 6 }} className="lucide-custom" />
    }

    return (
      <StatusIndicator status={status} hasError={hasError}>
        {label}
        {icon}
      </StatusIndicator>
    )
  }

  // Format tool responses for collapse items
  const getCollapseItems = () => {
    const items: { key: string; label: React.ReactNode; children: React.ReactNode }[] = []
    const hasError = response?.isError === true
    const result = {
      params: toolResponse.arguments,
      response: toolResponse.response
    }
    items.push({
      key: id,
      label: (
        <MessageTitleLabel>
          <TitleContent>
            <ToolName align="center" gap={4}>
              {tool.serverName} : {tool.name}
              {isToolAutoApproved(tool) && (
                <Tooltip title={t('message.tools.autoApproveEnabled')} mouseLeaveDelay={0}>
                  <ShieldCheck size={14} color="var(--status-color-success)" />
                </Tooltip>
              )}
            </ToolName>
          </TitleContent>
          <ActionButtonsContainer>
            {progress > 0 ? (
              <Progress type="circle" size={14} percent={Number((progress * 100)?.toFixed(0))} />
            ) : (
              renderStatusIndicator(status, hasError)
            )}
            {!isPending && (
              <Tooltip title={t('common.copy')} mouseEnterDelay={0.5}>
                <ActionButton
                  className="message-action-button"
                  onClick={(e) => {
                    e.stopPropagation()
                    copyContent(JSON.stringify(result, null, 2), id)
                  }}
                  aria-label={t('common.copy')}>
                  {!copiedMap[id] && <CopyIcon size={14} />}
                  {copiedMap[id] && <Check size={14} color="var(--status-color-success)" />}
                </ActionButton>
              </Tooltip>
            )}
          </ActionButtonsContainer>
        </MessageTitleLabel>
      ),
      children: (
        <ToolResponseContainer
          style={{
            fontFamily: messageFont === 'serif' ? 'var(--font-family-serif)' : 'var(--font-family)',
            fontSize
          }}>
          <ToolResponseContent
            isExpanded={activeKeys.includes(id)}
            args={isStreaming ? partialArguments : toolResponse.arguments}
            isStreaming={!!isStreaming}
            response={isDone || isError ? toolResponse.response : undefined}
          />
        </ToolResponseContainer>
      )
    })

    return items
  }

  return (
    <>
      <ConfigProvider
        theme={{
          components: {
            Button: {
              borderRadiusSM: 6
            }
          }
        }}>
        <ToolContainer>
          <ToolContentWrapper className={isPending ? 'pending' : status}>
            <CollapseContainer
              ghost
              activeKey={activeKeys}
              size="small"
              onChange={handleCollapseChange}
              className="message-tools-container"
              items={getCollapseItems()}
              expandIconPosition="end"
              expandIcon={({ isActive }) => (
                <ExpandIcon $isActive={isActive} size={18} color="var(--color-text-3)" strokeWidth={1.5} />
              )}
            />
            {isPending && (
              <ActionsBar>
                <ActionLabel>
                  {isWaitingConfirmation
                    ? t('settings.mcp.tools.autoApprove.tooltip.confirm')
                    : t('message.tools.invoking')}
                </ActionLabel>

                <ActionButtonsGroup>
                  {isWaitingConfirmation && (
                    <Button
                      color="danger"
                      variant="filled"
                      size="small"
                      onClick={() => {
                        handleCancelTool()
                      }}>
                      <CircleX size={15} className="lucide-custom" />
                      {t('common.cancel')}
                    </Button>
                  )}
                  {isExecuting && toolResponse?.id ? (
                    <Button
                      size="small"
                      color="danger"
                      variant="solid"
                      className="abort-button"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleAbortTool()
                      }}>
                      <PauseCircle size={14} className="lucide-custom" />
                      {t('chat.input.pause')}
                    </Button>
                  ) : (
                    isWaitingConfirmation && (
                      <StyledDropdownButton
                        size="small"
                        type="primary"
                        icon={<ChevronDown size={14} />}
                        onClick={() => {
                          handleConfirmTool()
                        }}
                        menu={{
                          items: [
                            {
                              key: 'autoApprove',
                              label: t('settings.mcp.tools.autoApprove.label'),
                              onClick: () => {
                                handleAutoApprove()
                              }
                            }
                          ]
                        }}>
                        <CirclePlay size={15} className="lucide-custom" />
                        <CountdownText>
                          {t('settings.mcp.tools.run', 'Run')} ({countdown}s)
                        </CountdownText>
                      </StyledDropdownButton>
                    )
                  )}
                </ActionButtonsGroup>
              </ActionsBar>
            )}
          </ToolContentWrapper>
        </ToolContainer>
      </ConfigProvider>
    </>
  )
}

/**
 * Extract preview content from MCP tool response using SDK schema
 */
const extractPreviewContent = (response: unknown): string => {
  if (!response) return ''

  const result = CallToolResultSchema.safeParse(response)
  if (result.success) {
    const contents = result.data.content
    if (contents.length === 0) return ''

    const textParts: string[] = []
    for (const content of contents) {
      switch (content.type) {
        case 'text':
          if (content.text) {
            try {
              const parsed = JSON.parse(content.text)
              textParts.push(JSON.stringify(parsed, null, 2))
            } catch {
              textParts.push(content.text)
            }
          }
          break
        case 'image':
          textParts.push(`[Image: ${content.mimeType ?? 'image/png'}]`)
          break
        case 'resource':
          textParts.push(`[Resource: ${content.resource?.uri ?? 'unknown'}]`)
          break
      }
    }
    return textParts.join('\n\n')
  }

  // Fallback: return JSON string for unknown format
  return JSON.stringify(response, null, 2)
}

// Unified tool response content component
const ToolResponseContent: FC<{
  isExpanded: boolean
  args: string | Record<string, unknown> | Record<string, unknown>[] | undefined
  isStreaming: boolean
  response?: unknown
}> = ({ isExpanded, args, isStreaming, response }) => {
  const { highlightCode } = useCodeStyle()
  const [highlightedResponse, setHighlightedResponse] = useState<string>('')

  // Parse args if it's a string (streaming partial JSON)
  const parsedArgs = useMemo(() => {
    if (!args) return null
    if (typeof args === 'string') {
      try {
        return parsePartialJson(args)
      } catch {
        return null
      }
    }
    return args
  }, [args])

  // Extract and highlight response when available
  useEffect(() => {
    if (!isExpanded || !response) return

    const highlight = async () => {
      const previewContent = extractPreviewContent(response)
      const result = await highlightCode(previewContent, 'json')
      setHighlightedResponse(result)
    }

    const timer = setTimeout(highlight, 0)
    return () => clearTimeout(timer)
  }, [isExpanded, response, highlightCode])

  if (!isExpanded) return null

  // Handle both object and array args - for arrays, show as single entry
  const getEntries = (): Array<[string, unknown]> => {
    if (!parsedArgs || typeof parsedArgs !== 'object') return []
    if (Array.isArray(parsedArgs)) {
      return [['arguments', parsedArgs]]
    }
    return Object.entries(parsedArgs)
  }
  const entries = getEntries()

  const renderArgsTable = (): React.ReactNode => {
    if (entries.length === 0) return null
    return (
      <ArgsSection>
        <ArgsSectionTitle>Arguments</ArgsSectionTitle>
        <ArgsTable>
          <tbody>
            {entries.map(([key, value]) => (
              <tr key={key}>
                <ArgKey>{key}</ArgKey>
                <ArgValue>{formatArgValue(value)}</ArgValue>
              </tr>
            ))}
            {isStreaming && (
              <tr>
                <ArgKey>
                  <SkeletonSpan width="60px" />
                </ArgKey>
                <ArgValue>
                  <SkeletonSpan width="120px" />
                </ArgValue>
              </tr>
            )}
          </tbody>
        </ArgsTable>
      </ArgsSection>
    )
  }

  return (
    <div>
      {/* Arguments Table */}
      {renderArgsTable()}

      {/* Response */}
      {response !== undefined && response !== null && highlightedResponse && (
        <ResponseSection>
          <ArgsSectionTitle>Response</ArgsSectionTitle>
          <MarkdownContainer className="markdown" dangerouslySetInnerHTML={{ __html: highlightedResponse }} />
        </ResponseSection>
      )}
    </div>
  )
}

const ToolContentWrapper = styled.div`
  padding: 1px;
  border-radius: 8px;
  overflow: hidden;

  .ant-collapse {
    border: 1px solid var(--color-border);
  }

  &.pending {
    background-color: var(--color-background-soft);
    .ant-collapse {
      border: none;
    }
  }
`

const ActionsBar = styled.div`
  padding: 8px;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
`

const ActionLabel = styled.div`
  flex: 1;
  font-size: 14px;
  color: var(--color-text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const ActionButtonsGroup = styled.div`
  display: flex;
  gap: 10px;
`

const CountdownText = styled.span`
  width: 65px;
  text-align: left;
`

const StyledDropdownButton = styled(Dropdown.Button)`
  .ant-btn-group {
    border-radius: 6px;
  }
`

const ExpandIcon = styled(ChevronRight)<{ $isActive?: boolean }>`
  transition: transform 0.2s;
  transform: ${({ $isActive }) => ($isActive ? 'rotate(90deg)' : 'rotate(0deg)')};
`

const CollapseContainer = styled(Collapse)`
  --status-color-warning: var(--color-status-warning, #faad14);
  --status-color-invoking: var(--color-primary);
  --status-color-error: var(--color-status-error, #ff4d4f);
  --status-color-success: var(--color-primary, green);
  border-radius: 7px;
  border: none;
  background-color: var(--color-background);
  overflow: hidden;

  .ant-collapse-header {
    padding: 8px 10px !important;
    align-items: center !important;
  }

  .ant-collapse-content-box {
    padding: 0 !important;
  }
`

const ToolContainer = styled.div`
  margin-top: 10px;
  margin-bottom: 10px;

  &:first-child {
    margin-top: 0;
    padding-top: 0;
  }
`

const MarkdownContainer = styled.div`
  & pre {
    background: transparent !important;
    span {
      white-space: pre-wrap;
    }
  }
`

const MessageTitleLabel = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  gap: 10px;
  padding: 0;
  margin-left: 4px;
`

const TitleContent = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
`

const ToolName = styled(Flex)`
  color: var(--color-text);
  font-weight: 500;
  font-size: 13px;
`

const StatusIndicator = styled.span<{ status: string; hasError?: boolean }>`
  color: ${(props) => {
    switch (props.status) {
      case 'pending':
        return 'var(--status-color-warning)'
      case 'invoking':
        return 'var(--status-color-invoking)'
      case 'cancelled':
        return 'var(--status-color-error)'
      case 'done':
        return props.hasError ? 'var(--status-color-error)' : 'var(--status-color-success)'
      case 'error':
        return 'var(--status-color-error)'
      default:
        return 'var(--color-text)'
    }
  }};
  font-size: 11px;
  font-weight: ${(props) => (props.status === 'pending' ? '600' : '400')};
  display: flex;
  align-items: center;
  opacity: ${(props) => (props.status === 'pending' ? '1' : '0.85')};
  padding-left: 12px;
`

const ActionButtonsContainer = styled.div`
  display: flex;
  gap: 6px;
  margin-left: auto;
  align-items: center;
`

const ActionButton = styled.button`
  background: none;
  border: none;
  color: var(--color-text-2);
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.7;
  transition: all 0.2s;
  border-radius: 4px;
  gap: 4px;
  min-width: 28px;
  height: 28px;

  &:hover {
    opacity: 1;
    color: var(--color-text);
    background-color: var(--color-bg-3);
  }

  &.confirm-button {
    color: var(--color-primary);

    &:hover {
      background-color: var(--color-primary-bg);
      color: var(--color-primary);
    }
  }

  &:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: 2px;
    opacity: 1;
  }

  .iconfont {
    font-size: 14px;
  }
`

const ToolResponseContainer = styled.div`
  border-radius: 0 0 4px 4px;
  overflow: auto;
  max-height: 300px;
  border-top: none;
  position: relative;
`

export default memo(MessageMcpTool)
