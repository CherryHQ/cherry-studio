import { CheckOutlined, ExpandOutlined, LoadingOutlined, WarningOutlined } from '@ant-design/icons'
import { useSettings } from '@renderer/hooks/useSettings'
import type { ToolMessageBlock } from '@renderer/types/newMessage'
import { useShikiWithMarkdownIt } from '@renderer/utils/shiki'
import { Collapse, message as antdMessage, Modal, Tabs, Tooltip } from 'antd'
import { FC, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  blocks: ToolMessageBlock
}

const MessageTools: FC<Props> = ({ blocks }) => {
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

  const toolResponse = blocks.metadata?.rawMcpToolResponse

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
  const { renderedMarkdown: styledResult } = useShikiWithMarkdownIt(`\`\`\`json\n${resultString}\n\`\`\``)

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

  // Format tool responses for collapse items
  const getCollapseItems = () => {
    const items: { key: string; label: React.ReactNode; children: React.ReactNode }[] = []
    // Add tool responses
    // for (const toolResponse of toolResponses) {
    const { id, tool, status, response } = toolResponse
    const isInvoking = status === 'invoking'
    const isDone = status === 'done'
    const hasError = isDone && response?.isError === true
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
            <StatusIndicator $isInvoking={isInvoking} $hasError={hasError}>
              {isInvoking
                ? t('message.tools.invoking')
                : hasError
                  ? t('message.tools.error')
                  : t('message.tools.completed')}
              {isInvoking && <LoadingOutlined spin style={{ marginLeft: 6 }} />}
              {isDone && !hasError && <CheckOutlined style={{ marginLeft: 6 }} />}
              {hasError && <WarningOutlined style={{ marginLeft: 6 }} />}
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
      children: isDone && result && (
        <ToolResponseContainer style={{ fontFamily, fontSize: '12px' }}>
          <div className="markdown" dangerouslySetInnerHTML={{ __html: styledResult }} />
        </ToolResponseContainer>
      )
    })
    // }

    return items
  }

  const renderPreview = (content: string) => {
    if (!content) return null

    try {
      const parsedResult = JSON.parse(content)
      switch (parsedResult.content[0]?.type) {
        case 'text':
          return <PreviewBlock>{parsedResult.content[0].text}</PreviewBlock>
        // TODO: support other types
        default:
          return <PreviewBlock>{content}</PreviewBlock>
      }
    } catch (e) {
      console.error('failed to render the preview of mcp results:', e)
      return <PreviewBlock>{content}</PreviewBlock>
    }
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
        centered
        transitionName="animation-move-down"
        styles={{ body: { maxHeight: '80vh', overflow: 'auto' } }}>
        {expandedResponse && (
          <ExpandedResponseContainer style={{ fontFamily, fontSize }}>
            {/* mode swtich tabs */}
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
                  children: <div className="markdown" dangerouslySetInnerHTML={{ __html: styledResult }} />
                }
              ]}
            />
          </ExpandedResponseContainer>
        )}
      </Modal>
    </>
  )
}

const CollapseContainer = styled(Collapse)`
  margin-top: 10px;
  margin-bottom: 12px;
  border-radius: 8px;
  overflow: hidden;

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

const StatusIndicator = styled.span<{ $isInvoking: boolean; $hasError?: boolean }>`
  color: ${(props) => {
    if (props.$hasError) return 'var(--color-error, #ff4d4f)'
    if (props.$isInvoking) return 'var(--color-primary)'
    return 'var(--color-success, #52c41a)'
  }};
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
  border-radius: 0 0 4px 4px;
  overflow: auto;
  max-height: 300px;
  border-top: none;
  position: relative;
`

const PreviewBlock = styled.div`
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--color-text);
  user-select: text;
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
