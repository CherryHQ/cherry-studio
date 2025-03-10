import { CheckOutlined, ExpandOutlined, LoadingOutlined } from '@ant-design/icons'
import { useSettings } from '@renderer/hooks/useSettings'
import { MCPToolResponse, Message } from '@renderer/types'
import { Collapse, message as antdMessage, Modal, Tooltip } from 'antd'
import { isEmpty } from 'lodash'
import { FC, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  message: Message
}

const MessageTools: FC<Props> = ({ message }) => {
  const [activeKeys, setActiveKeys] = useState<string[]>([])
  const [copiedMap, setCopiedMap] = useState<Record<string, boolean>>({})
  const [expandedResponse, setExpandedResponse] = useState<{ content: string; title: string } | null>(null)
  const { t } = useTranslation()
  const { messageFont, fontSize } = useSettings()
  const fontFamily = useMemo(() => {
    return messageFont === 'serif'
      ? 'serif'
      : '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Open Sans","Helvetica Neue", sans-serif'
  }, [messageFont])

  const toolResponses = message.metadata?.mcpTools || []

  if (isEmpty(toolResponses)) {
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

  // Format tool responses for collapse items
  const getCollapseItems = () => {
    const items: { key: string; label: JSX.Element; children: React.ReactNode }[] = []

    // Add tool responses
    toolResponses.forEach((toolResponse: MCPToolResponse) => {
      const { tool, status } = toolResponse
      const toolId = tool.id
      const isInvoking = status === 'invoking'
      const isDone = status === 'done'
      const response = {
        params: tool.inputSchema,
        response: toolResponse.response
      }

      items.push({
        key: toolId,
        label: (
          <MessageTitleLabel>
            <TitleContent>
              <ToolName>{tool.name}</ToolName>
              <StatusIndicator $isInvoking={isInvoking}>
                {isInvoking ? t('tools.invoking') : t('tools.completed')}
                {isInvoking && <LoadingOutlined spin style={{ marginLeft: 6 }} />}
                {isDone && <CheckOutlined style={{ marginLeft: 6 }} />}
              </StatusIndicator>
            </TitleContent>
            <ActionButtonsContainer>
              {isDone && response && (
                <>
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
                      <ExpandOutlined />
                    </ActionButton>
                  </Tooltip>
                  <Tooltip title={t('common.copy')} mouseEnterDelay={0.5}>
                    <ActionButton
                      className="message-action-button"
                      onClick={(e) => {
                        e.stopPropagation()
                        copyContent(JSON.stringify(response, null, 2), toolId)
                      }}
                      aria-label={t('common.copy')}>
                      {!copiedMap[toolId] && <i className="iconfont icon-copy"></i>}
                      {copiedMap[toolId] && <CheckOutlined style={{ color: 'var(--color-primary)' }} />}
                    </ActionButton>
                  </Tooltip>
                </>
              )}
            </ActionButtonsContainer>
          </MessageTitleLabel>
        ),
        children: isDone && response && (
          <ToolResponseContainer style={{ fontFamily, fontSize }}>
            <pre>{JSON.stringify(response, null, 2)}</pre>
          </ToolResponseContainer>
        )
      })
    })

    return items
  }

  return (
    <>
      <CollapseContainer
        activeKey={activeKeys}
        size="small"
        onChange={handleCollapseChange}
        className="message-tools-container"
        items={getCollapseItems()}
        expandIcon={({ isActive }) => (
          <CollapsibleIcon className={`iconfont ${isActive ? 'icon-chevron-down' : 'icon-chevron-right'}`} />
        )}
      />

      <Modal
        title={expandedResponse?.title}
        open={!!expandedResponse}
        onCancel={() => setExpandedResponse(null)}
        footer={null}
        width="80%"
        bodyStyle={{ maxHeight: '80vh', overflow: 'auto' }}>
        {expandedResponse && (
          <ExpandedResponseContainer style={{ fontFamily, fontSize }}>
            <ActionButton
              className="copy-expanded-button"
              onClick={() => {
                if (expandedResponse) {
                  navigator.clipboard.writeText(expandedResponse.content)
                  antdMessage.success({ content: t('message.copied'), key: 'copy-expanded' })
                }
              }}
              aria-label={t('common.copy')}>
              <i className="iconfont icon-copy"></i>
            </ActionButton>
            <pre>{expandedResponse.content}</pre>
          </ExpandedResponseContainer>
        )}
      </Modal>
    </>
  )
}

const CollapseContainer = styled(Collapse)`
  margin-bottom: 15px;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);

  .ant-collapse-header {
    background-color: var(--color-bg-2);
    transition: background-color 0.2s;

    &:hover {
      background-color: var(--color-bg-3);
    }
  }

  .ant-collapse-content-box {
    padding: 0 !important;
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

const StatusIndicator = styled.span<{ $isInvoking: boolean }>`
  color: ${(props) => (props.$isInvoking ? 'var(--color-primary)' : 'var(--color-success, #52c41a)')};
  font-size: 11px;
  display: flex;
  align-items: center;
  opacity: 0.85;
  border-left: 1px solid var(--color-border);
  padding-left: 8px;
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
  padding: 4px 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.7;
  transition: all 0.2s;
  border-radius: 4px;

  &:hover {
    opacity: 1;
    color: var(--color-text);
    background-color: var(--color-bg-1);
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

const CollapsibleIcon = styled.i`
  color: var(--color-text-2);
  font-size: 12px;
  transition: transform 0.2s;
`

const ToolResponseContainer = styled.div`
  background: var(--color-bg-1);
  border-radius: 0 0 4px 4px;
  padding: 12px 16px;
  overflow: auto;
  max-height: 300px;
  border-top: 1px solid var(--color-border);
  position: relative;

  pre {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--color-text);
  }
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

export default MessageTools
