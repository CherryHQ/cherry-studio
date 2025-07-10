import { CheckOutlined, CloseOutlined, LoadingOutlined, WarningOutlined } from '@ant-design/icons'
import { useCodeStyle } from '@renderer/context/CodeStyleProvider'
import { useSettings } from '@renderer/hooks/useSettings'
import type { ToolMessageBlock } from '@renderer/types/newMessage'
import { cancelToolAction, confirmToolAction } from '@renderer/utils/userConfirmation'
import { Collapse, message as antdMessage, Tooltip } from 'antd'
import { message } from 'antd'
import Logger from 'electron-log/renderer'
import { PauseCircle } from 'lucide-react'
import { FC, memo, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  block: ToolMessageBlock
}

const MessageTools: FC<Props> = ({ block }) => {
  const [activeKeys, setActiveKeys] = useState<string[]>([])
  const [copiedMap, setCopiedMap] = useState<Record<string, boolean>>({})
  const { t } = useTranslation()
  const { messageFont, fontSize } = useSettings()

  const toolResponse = block.metadata?.rawMcpToolResponse

  const { id, tool, status, response } = toolResponse!

  const isPending = status === 'pending'
  const isInvoking = status === 'invoking'
  const isDone = status === 'done'

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
    confirmToolAction(id)
  }

  const handleCancelTool = () => {
    cancelToolAction(id)
  }

  const handleAbortTool = async () => {
    if (toolResponse?.id) {
      try {
        const success = await window.api.mcp.abortTool(toolResponse.id)
        if (success) {
          message.success({ content: t('message.tools.aborted'), key: 'abort-tool' })
        } else {
          message.error({ content: t('message.tools.abort_failed'), key: 'abort-tool' })
        }
      } catch (error) {
        Logger.error('Failed to abort tool:', error)
        message.error({ content: t('message.tools.abort_failed'), key: 'abort-tool' })
      }
    }
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
            <ToolName>{tool.name}</ToolName>
            <StatusIndicator status={status} hasError={hasError}>
              {(() => {
                switch (status) {
                  case 'pending':
                    return (
                      <>
                        {t('message.tools.pending')}
                        <LoadingOutlined spin style={{ marginLeft: 6 }} />
                      </>
                    )
                  case 'invoking':
                    return (
                      <>
                        {t('message.tools.invoking')}
                        <LoadingOutlined spin style={{ marginLeft: 6 }} />
                      </>
                    )
                  case 'cancelled':
                    return (
                      <>
                        {t('message.tools.cancelled')}
                        <CloseOutlined style={{ marginLeft: 6 }} />
                      </>
                    )
                  case 'done':
                    if (hasError) {
                      return (
                        <>
                          {t('message.tools.error')}
                          <WarningOutlined style={{ marginLeft: 6 }} />
                        </>
                      )
                    } else {
                      return (
                        <>
                          {t('message.tools.completed')}
                          <CheckOutlined style={{ marginLeft: 6 }} />
                        </>
                      )
                    }
                  default:
                    return ''
                }
              })()}
            </StatusIndicator>
          </TitleContent>
          <ActionButtonsContainer>
            {isPending && (
              <>
                <Tooltip title={t('common.cancel')} mouseEnterDelay={0.3}>
                  <ActionButton
                    onClick={(e) => {
                      e.stopPropagation()
                      handleCancelTool()
                    }}
                    aria-label={t('common.cancel')}>
                    <CloseOutlined style={{ fontSize: '14px' }} />
                  </ActionButton>
                </Tooltip>
                <Tooltip title={t('common.confirm')} mouseEnterDelay={0.3}>
                  <ActionButton
                    className="confirm-button"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleConfirmTool()
                    }}
                    aria-label={t('common.confirm')}>
                    <CheckOutlined style={{ fontSize: '14px' }} />
                  </ActionButton>
                </Tooltip>
              </>
            )}
            {isInvoking && toolResponse?.id && (
              <Tooltip title={t('chat.input.pause')} mouseEnterDelay={0.3}>
                <ActionButton
                  className="abort-button"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleAbortTool()
                  }}
                  aria-label={t('chat.input.pause')}>
                  <PauseCircle color="var(--color-error)" size={14} />
                </ActionButton>
              </Tooltip>
            )}
            {isDone && response && (
              <>
                <Tooltip title={t('common.copy')} mouseEnterDelay={0.5}>
                  <ActionButton
                    className="message-action-button"
                    onClick={(e) => {
                      e.stopPropagation()
                      copyContent(JSON.stringify(result, null, 2), id)
                    }}
                    aria-label={t('common.copy')}>
                    {!copiedMap[id] && <i className="iconfont icon-copy"></i>}
                    {copiedMap[id] && <CheckOutlined style={{ color: 'var(--color-primary)' }} />}
                  </ActionButton>
                </Tooltip>
              </>
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

  return (
    <ToolContainer>
      <CollapseContainer
        activeKey={activeKeys}
        size="small"
        onChange={handleCollapseChange}
        className="message-tools-container"
        items={getCollapseItems()}
        expandIconPosition="end"
      />
    </ToolContainer>
  )
}

// New component to handle collapsed content
const CollapsedContent: FC<{ isExpanded: boolean; resultString: string }> = ({ isExpanded, resultString }) => {
  const { highlightCode } = useCodeStyle()
  const [styledResult, setStyledResult] = useState<string>('')

  useEffect(() => {
    const highlight = async () => {
      const result = await highlightCode(isExpanded ? resultString : '', 'json')
      setStyledResult(result)
    }

    setTimeout(highlight, 0)
  }, [isExpanded, resultString, highlightCode])

  if (!isExpanded) {
    return null
  }

  return <MarkdownContainer className="markdown" dangerouslySetInnerHTML={{ __html: styledResult }} />
}

const CollapseContainer = styled(Collapse)`
  border-radius: 8px;
  border: none;
  overflow: hidden;

  .ant-collapse-header {
    background-color: var(--color-bg-2);
    transition: background-color 0.2s;
    display: flex;
    align-items: center;
    .ant-collapse-expand-icon {
      height: 100% !important;
    }
    .ant-collapse-arrow {
      height: 28px !important;
      svg {
        width: 14px;
        height: 14px;
      }
    }
    &:hover {
      background-color: var(--color-bg-3);
    }
  }

  .ant-collapse-content-box {
    padding: 0 !important;
  }
`

const ToolContainer = styled.div`
  margin-top: 10px;
  margin-bottom: 12px;
  border: 1px solid var(--color-border);
  background-color: var(--color-bg-2);
  border-radius: 8px;
  overflow: hidden;
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
  min-height: 26px;
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

const ToolName = styled.span`
  color: var(--color-text);
  font-weight: 500;
  font-size: 13px;
`

const StatusIndicator = styled.span<{ status: string; hasError?: boolean }>`
  color: ${(props) => {
    switch (props.status) {
      case 'pending':
        return 'var(--color-text-2)'
      case 'invoking':
        return 'var(--color-primary)'
      case 'cancelled':
        return 'var(--color-error, #ff4d4f)' // Assuming cancelled should also be an error color
      case 'done':
        return props.hasError ? 'var(--color-error, #ff4d4f)' : 'var(--color-success, #52c41a)'
      default:
        return 'var(--color-text)'
    }
  }};
  font-size: 11px;
  display: flex;
  align-items: center;
  opacity: 0.85;
  border-left: 1px solid var(--color-border);
  padding-left: 12px;
`

const ActionButtonsContainer = styled.div`
  display: flex;
  gap: 8px;
  margin-left: auto;
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

export default memo(MessageTools)
