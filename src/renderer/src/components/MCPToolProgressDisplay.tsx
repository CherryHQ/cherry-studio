import { LoadingOutlined } from '@ant-design/icons'
import { useSettings } from '@renderer/hooks/useSettings'
import { MCPToolProgressChunk } from '@renderer/types/chunk'
import { Progress, Typography } from 'antd'
import { FC, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  toolName: string
  toolId: string
  progressChunks: MCPToolProgressChunk[]
}

const MCPToolProgressDisplay: FC<Props> = ({ toolName, progressChunks }) => {
  const { t } = useTranslation()
  const { messageFont } = useSettings()
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Get the latest progress values
  const latestProgress = progressChunks[progressChunks.length - 1]
  const progressPercent = latestProgress?.total
    ? Math.round((latestProgress.progress / latestProgress.total) * 100)
    : undefined

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [progressChunks.length])

  return (
    <ProgressContainer>
      <ProgressHeader>
        <ToolName>{toolName}</ToolName>
        <StatusIndicator>
          {t('message.tools.invoking')}
          <LoadingOutlined spin style={{ marginLeft: 6 }} />
        </StatusIndicator>
      </ProgressHeader>

      <ProgressSection>
        <Progress
          percent={progressPercent}
          status={progressPercent ? 'active' : undefined}
          showInfo={progressPercent !== undefined}
          strokeColor="var(--color-primary)"
        />
        {latestProgress?.message && (
          <ProgressMessage
            style={{
              fontFamily: messageFont === 'serif' ? 'var(--font-family-serif)' : 'var(--font-family)',
              fontSize: '13px'
            }}>
            {latestProgress.message}
          </ProgressMessage>
        )}
      </ProgressSection>

      {progressChunks.length > 0 && (
        <MessageLogSection>
          <MessageLogHeader>
            <Typography.Text type="secondary" style={{ fontSize: '12px' }}>
              {t('message.tools.progress.log')}
            </Typography.Text>
          </MessageLogHeader>
          <MessageLog
            style={{
              fontFamily: messageFont === 'serif' ? 'var(--font-family-serif)' : 'var(--font-family)',
              fontSize: '12px'
            }}>
            {progressChunks.map((chunk, index) => (
              <MessageLogItem key={`${chunk.progressToken}-${index}`}>
                <MessageTimestamp>
                  {chunk.total ? `${chunk.progress}/${chunk.total}` : `${chunk.progress}`}
                </MessageTimestamp>
                {chunk.message && <MessageText>{chunk.message}</MessageText>}
              </MessageLogItem>
            ))}
            <div ref={messagesEndRef} />
          </MessageLog>
        </MessageLogSection>
      )}
    </ProgressContainer>
  )
}

const ProgressContainer = styled.div`
  display: flex;
  flex-direction: column;
  padding: 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius);
  background: var(--color-background-soft);
  margin: 8px 0;
`

const ProgressHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
`

const ToolName = styled.div`
  font-weight: 600;
  color: var(--color-text);
  font-size: 14px;
`

const StatusIndicator = styled.div`
  display: flex;
  align-items: center;
  font-size: 12px;
  color: var(--color-text-2);
`

const ProgressSection = styled.div`
  margin-bottom: 8px;
`

const ProgressMessage = styled.div`
  margin-top: 8px;
  color: var(--color-text-2);
`

const MessageLogSection = styled.div`
  border-top: 1px solid var(--color-border);
  padding-top: 8px;
  margin-top: 8px;
`

const MessageLogHeader = styled.div`
  margin-bottom: 6px;
`

const MessageLog = styled.div`
  max-height: 120px;
  overflow-y: auto;
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  padding: 8px;
`

const MessageLogItem = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 4px;

  &:last-child {
    margin-bottom: 0;
  }
`

const MessageTimestamp = styled.div`
  font-size: 11px;
  color: var(--color-text-3);
  font-family: var(--code-font-family);
`

const MessageText = styled.div`
  color: var(--color-text-2);
`

export default MCPToolProgressDisplay
