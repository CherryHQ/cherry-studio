import { ArrowUpOutlined, BookOutlined, MenuOutlined } from '@ant-design/icons'
import { HStack, VStack } from '@renderer/components/Layout'
import { useSettings } from '@renderer/hooks/useSettings'
import { Divider, Popover, Progress } from 'antd'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

type Props = {
  estimateTokenCount: number
  inputTokenCount: number
  contextCount: { current: number; max: number }
  knowledgeTokenCount?: number
  ToolbarButton: any
  maxTokens: number
  onClick?: () => void
} & React.HTMLAttributes<HTMLDivElement>

const TokenCount: FC<Props> = ({
  estimateTokenCount,
  inputTokenCount,
  contextCount,
  knowledgeTokenCount,
  maxTokens,
  onClick
}) => {
  const { t } = useTranslation()
  const { showInputEstimatedTokens } = useSettings()

  if (!showInputEstimatedTokens) {
    return null
  }

  const formatMaxCount = (max: number) => {
    if (max == 20) {
      return (
        <span
          style={{
            fontSize: '16px',
            position: 'relative',
            top: '1px'
          }}>
          ∞
        </span>
      )
    }
    return max.toString()
  }

  const getTotalTokens = () => {
    const kb = knowledgeTokenCount || 0
    return contextCount.current + estimateTokenCount + kb
  }

  const getTotalPercent = () => {
    return Math.min(100, Math.round((getTotalTokens() / maxTokens) * 100))
  }

  const formatNumber = (num: number) => {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  }

  const PopoverContent = () => {
    return (
      <VStack w="250px" background="100%" gap="4px">
        <HStack justifyContent="space-between" w="100%" alignItems="center">
          <Text>{t('chat.input.context_count.tip')}</Text>
          <Text>
            {contextCount.current} / {contextCount.max == 20 ? '∞' : contextCount.max}
          </Text>
        </HStack>

        {/* 知识库 tokens */}
        {knowledgeTokenCount !== undefined && knowledgeTokenCount > 0 && (
          <>
            <Divider style={{ margin: '5px 0' }} />
            <HStack justifyContent="space-between" w="100%" alignItems="center">
              <Text>{t('chat.input.knowledge_tokens.tip')}</Text>
              <Text>{knowledgeTokenCount}</Text>
            </HStack>
          </>
        )}
        <Divider style={{ margin: '5px 0' }} />

        {/* 估计 tokens */}
        <HStack justifyContent="space-between" w="100%" alignItems="center">
          <Text>{t('chat.input.estimated_tokens.tip')}</Text>
          <Text>{estimateTokenCount}</Text>
        </HStack>

        <Divider style={{ margin: '5px 0' }} />

        {/* 总计 tokens */}
        <HStack justifyContent="space-between" w="100%" alignItems="center">
          <Text>{t('chat.input.total_usage')}</Text>
          <Text>{getTotalTokens()}</Text>
        </HStack>
        <ProgressBar percent={getTotalPercent()} size="small" showInfo={false} status="active" />

        {/* 剩余可用 */}
        <Divider style={{ margin: '5px 0' }} />
        <HStack justifyContent="space-between" w="100%" alignItems="center">
          <Text>{t('chat.input.remaining_available')}</Text>
          <Text>{formatNumber(maxTokens - getTotalTokens())}</Text>
        </HStack>
      </VStack>
    )
  }

  return (
    <Container onClick={onClick}>
      <Popover content={PopoverContent}>
        <MenuOutlined /> {contextCount.current} / {formatMaxCount(contextCount.max)}
        <Divider type="vertical" style={{ marginTop: 0, marginLeft: 5, marginRight: 5 }} />
        <ArrowUpOutlined />
        {inputTokenCount} / {estimateTokenCount}
        {knowledgeTokenCount !== undefined && knowledgeTokenCount > 0 && (
          <>
            <Divider type="vertical" style={{ marginTop: 0, marginLeft: 5, marginRight: 5 }} />
            <BookOutlined />
            {knowledgeTokenCount}
          </>
        )}
      </Popover>
    </Container>
  )
}

const Container = styled.div`
  font-size: 11px;
  line-height: 16px;
  color: var(--color-text-2);
  z-index: 10;
  padding: 3px 10px;
  user-select: none;
  font-family: Ubuntu;
  border: 0.5px solid var(--color-text-3);
  border-radius: 20px;
  display: flex;
  align-items: center;
  cursor: pointer;
  .anticon {
    font-size: 10px;
    margin-right: 3px;
  }
  @media (max-width: 700px) {
    display: none;
  }
`

const Text = styled.div`
  font-size: 12px;
  color: var(--color-text-1);
`

const ProgressBar = styled(Progress)`
  .ant-progress-inner {
    background-color: var(--color-background-soft);
  }

  .ant-progress-bg {
    background-color: var(--color-primary);
  }
`

export default TokenCount
