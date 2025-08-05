import { loggerService } from '@logger'
import { CopyIcon, LoadingIcon } from '@renderer/components/Icons'
import { useCodeStyle } from '@renderer/context/CodeStyleProvider'
import { useMCPServers } from '@renderer/hooks/useMCPServers'
import { useSettings } from '@renderer/hooks/useSettings'
import type { ToolMessageBlock } from '@renderer/types/newMessage'
import { isToolAutoApproved } from '@renderer/utils/mcp-tools'
import { cancelToolAction, confirmToolAction } from '@renderer/utils/userConfirmation'
import {
  Button,
  Collapse,
  ConfigProvider,
  Dropdown,
  Flex,
  message as antdMessage,
  Modal,
  Progress,
  Tabs,
  Tooltip
} from 'antd'
import { message } from 'antd'
import {
  Check,
  ChevronDown,
  ChevronRight,
  CirclePlay,
  CircleX,
  Maximize,
  PauseCircle,
  ShieldCheck,
  TriangleAlert,
  X
} from 'lucide-react'
import { FC, memo, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  block: ToolMessageBlock
}

const logger = loggerService.withContext('MessageTools')

const COUNTDOWN_TIME = 30

const MessageTools: FC<Props> = ({ block }) => {
  const [activeKeys, setActiveKeys] = useState<string[]>([])
  const [copiedMap, setCopiedMap] = useState<Record<string, boolean>>({})
  const [countdown, setCountdown] = useState<number>(COUNTDOWN_TIME)
  const { t } = useTranslation()
  const { messageFont, fontSize } = useSettings()
  const { mcpServers, updateMCPServer } = useMCPServers()
  const [expandedResponse, setExpandedResponse] = useState<{ content: string; title: string } | null>(null)
  const [progress, setProgress] = useState<number>(0)

  const toolResponse = block.metadata?.rawMcpToolResponse

  const { id, tool, status, response } = toolResponse!

  const isPending = status === 'pending'
  const isInvoking = status === 'invoking'
  const isDone = status === 'done'

  const timer = useRef<NodeJS.Timeout | null>(null)
  useEffect(() => {
    if (!isPending) return

    if (countdown > 0) {
      timer.current = setTimeout(() => {
        logger.debug(`countdown: ${countdown}`)
        setCountdown((prev) => prev - 1)
      }, 1000)
    } else if (countdown === 0) {
      confirmToolAction(id)
    }

    return () => {
      if (timer.current) {
        clearTimeout(timer.current)
      }
    }
  }, [countdown, id, isPending])

  useEffect(() => {
    const removeListener = window.electron.ipcRenderer.on(
      'mcp-progress',
      (_event: Electron.IpcRendererEvent, value: number) => {
        setProgress(value)
      }
    )
    return () => {
      setProgress(0)
      removeListener()
    }
  }, [])

  const cancelCountdown = () => {
    if (timer.current) {
      clearTimeout(timer.current)
    }
  }

  const argsString = useMemo(() => {
    if (toolResponse?.arguments) {
      return JSON.stringify(toolResponse.arguments, null, 2)
    }
    return 'No arguments'
  }, [toolResponse])

  const resultString = useMemo(() => {
    try {
      return JSON.stringify(
        {
          params: toolResponse?.arguments,
          response: toolResponse?.response
        },
        null,
        2
      )
    } catch (e) {
      return 'Invalid Result'
    }
  }, [toolResponse])

  if (!toolResponse) {
    return null
  }

  const copyContent = (content: string, toolId: string) => {
    navigator.clipboard.writeText(content)
    antdMessage.success({ content: t('message.copied'), key: 'copy-message' })
    setCopiedMap((prev) => ({ ...prev, [toolId]: true }))
    setTimeout(() => setCopiedMap((prev) => ({ ...prev, [toolId]: false })), 2000)
  }

  const handleCollapseChange = (keys: string | string[]) => {
    setActiveKeys(Array.isArray(keys) ? keys : [keys])
  }

  const handleConfirmTool = () => {
    cancelCountdown()
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
          window.message.success({ content: t('message.tools.aborted'), key: 'abort-tool' })
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
    confirmToolAction(id)

    window.message.success({
      content: t('message.tools.autoApproveEnabled', 'Auto-approve enabled for this tool'),
      key: 'auto-approve'
    })
  }

  const renderStatusIndicator = (status: string, hasError: boolean) => {
    let label = ''
    let icon: React.ReactNode | null = null
    switch (status) {
      case 'pending':
        label = t('message.tools.pending', 'Awaiting Approval')
        icon = <LoadingIcon style={{ marginLeft: 6, color: 'var(--status-color-warning)' }} />
        break
      case 'invoking':
        label = t('message.tools.invoking')
        icon = <LoadingIcon style={{ marginLeft: 6 }} />
        break
      case 'cancelled':
        label = t('message.tools.cancelled')
        icon = <X size={13} style={{ marginLeft: 6 }} className="lucide-custom" />
        break
      case 'done':
        if (hasError) {
          label = t('message.tools.error')
          icon = <TriangleAlert size={13} style={{ marginLeft: 6 }} className="lucide-custom" />
        } else {
          label = t('message.tools.completed')
          icon = <Check size={13} style={{ marginLeft: 6 }} className="lucide-custom" />
        }
        break
      default:
        label = ''
        icon = null
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
            <Tooltip title={t('common.expand')} mouseEnterDelay={0.5}>
              <ActionButton
                className="message-action-button"
                onClick={(e) => {
                  e.stopPropagation()
                  setExpandedResponse({
                    content: JSON.stringify(response, null, 2),
                    title: tool.name
                  })
                }}
                aria-label={t('common.expand')}>
                <Maximize size={14} />
              </ActionButton>
            </Tooltip>
            {!isPending && !isInvoking && (
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
      children:
        isDone && result ? (
          <ToolResponseContainer
            style={{
              fontFamily: messageFont === 'serif' ? 'var(--font-family-serif)' : 'var(--font-family)',
              fontSize
            }}>
            <CollapsedContent isExpanded={activeKeys.includes(id)} resultString={resultString} />
          </ToolResponseContainer>
        ) : argsString ? (
          <>
            <ToolResponseContainer>
              <CollapsedContent isExpanded={activeKeys.includes(id)} resultString={argsString} />
            </ToolResponseContainer>
          </>
        ) : null
    })

    return items
  }

  const renderPreview = (content: string) => {
    if (!content) return null

    try {
      logger.debug(`renderPreview: ${content}`)
      const parsedResult = JSON.parse(content)
      switch (parsedResult.content[0]?.type) {
        case 'text':
          try {
            return (
              <CollapsedContent
                isExpanded={true}
                resultString={JSON.stringify(JSON.parse(parsedResult.content[0].text), null, 2)}
              />
            )
          } catch (e) {
            return (
              <CollapsedContent
                isExpanded={true}
                resultString={JSON.stringify(parsedResult.content[0].text, null, 2)}
              />
            )
          }

        default:
          return <CollapsedContent isExpanded={true} resultString={JSON.stringify(parsedResult, null, 2)} />
      }
    } catch (e) {
      logger.error('failed to render the preview of mcp results:', e as Error)
      return (
        <CollapsedContent
          isExpanded={true}
          resultString={e instanceof Error ? e.message : JSON.stringify(e, null, 2)}
        />
      )
    }
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
          <ToolContentWrapper className={status}>
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
            {(isPending || isInvoking) && (
              <ActionsBar>
                <ActionLabel>
                  {isPending ? t('settings.mcp.tools.autoApprove.tooltip.confirm') : t('message.tools.invoking')}
                </ActionLabel>

                <ActionButtonsGroup>
                  {isPending && (
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
                  {isInvoking && toolResponse?.id ? (
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
                  )}
                </ActionButtonsGroup>
              </ActionsBar>
            )}
          </ToolContentWrapper>
        </ToolContainer>
      </ConfigProvider>
      <Modal
        title={expandedResponse?.title}
        open={!!expandedResponse}
        onCancel={() => setExpandedResponse(null)}
        footer={null}
        width="80%"
        centered
        transitionName="animation-move-down"
        styles={{ body: { maxHeight: '80vh', overflow: 'auto' } }}>
        {expandedResponse && (
          <ExpandedResponseContainer
            style={{
              fontFamily: messageFont === 'serif' ? 'var(--font-family-serif)' : 'var(--font-family)',
              fontSize
            }}>
            <Tabs
              tabBarExtraContent={
                <ActionButton
                  className="copy-expanded-button"
                  onClick={() => {
                    navigator.clipboard.writeText(
                      typeof expandedResponse.content === 'string'
                        ? expandedResponse.content
                        : JSON.stringify(expandedResponse.content, null, 2)
                    )
                    antdMessage.success({ content: t('message.copied'), key: 'copy-expanded' })
                  }}
                  aria-label={t('common.copy')}>
                  <i className="iconfont icon-copy"></i>
                </ActionButton>
              }
              items={[
                {
                  key: 'preview',
                  label: t('message.tools.preview'),
                  children: renderPreview(expandedResponse.content)
                },
                {
                  key: 'raw',
                  label: t('message.tools.raw'),
                  children: (
                    <CollapsedContent
                      isExpanded={true}
                      resultString={
                        typeof expandedResponse.content === 'string'
                          ? expandedResponse.content
                          : JSON.stringify(expandedResponse.content, null, 2)
                      }
                    />
                  )
                }
              ]}
            />
          </ExpandedResponseContainer>
        )}
      </Modal>
    </>
  )
}

// New component to handle collapsed content
const CollapsedContent: FC<{ isExpanded: boolean; resultString: string }> = ({ isExpanded, resultString }) => {
  const { highlightCode } = useCodeStyle()
  const [styledResult, setStyledResult] = useState<string>('')

  useEffect(() => {
    if (!isExpanded) {
      return
    }

    const highlight = async () => {
      const result = await highlightCode(resultString, 'json')
      setStyledResult(result)
    }

    const timer = setTimeout(highlight, 0)

    return () => clearTimeout(timer)
  }, [isExpanded, resultString, highlightCode])

  if (!isExpanded) {
    return null
  }

  return <MarkdownContainer className="markdown" dangerouslySetInnerHTML={{ __html: styledResult }} />
}

const ToolContentWrapper = styled.div`
  padding: 1px;
  border-radius: 8px;
  overflow: hidden;

  .ant-collapse {
    border: 1px solid var(--color-border);
  }

  &.pending,
  &.invoking {
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

const ExpandedResponseContainer = styled.div`
  background: var(--color-bg-1);
  border-radius: 8px;
  padding: 16px;
  position: relative;

  .copy-expanded-button {
    position: absolute;
    top: 10px;
    right: 10px;
    background-color: var(--color-bg-2);
    border-radius: 4px;
    z-index: 1;
  }

  pre {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--color-text);
  }
`

export default memo(MessageTools)
