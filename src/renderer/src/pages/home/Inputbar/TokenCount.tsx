import { ArrowUpOutlined, MenuOutlined } from '@ant-design/icons'
import { HStack, VStack } from '@renderer/components/Layout'
import { useSettings } from '@renderer/hooks/useSettings'
import { Divider, Popover } from 'antd'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

type Props = {
  estimateTokenCount: number
  inputTokenCount: number
  contextCount: number
  ToolbarButton: any
} & React.HTMLAttributes<HTMLDivElement>

const TokenCount: FC<Props> = ({ estimateTokenCount, inputTokenCount, contextCount }) => {
  const { t } = useTranslation()
  const { showInputEstimatedTokens } = useSettings()

  if (!showInputEstimatedTokens) {
    return null
  }

  const PopoverContent = () => {
    return (
      <VStack w="150px" background="100%">
        <HStack justifyContent="space-between" w="100%">
          <Text>{t('chat.input.context_count.tip')}</Text>
          <Text>{contextCount}</Text>
        </HStack>
        <Divider style={{ margin: '5px 0' }} />
        <HStack justifyContent="space-between" w="100%">
          <Text>{t('chat.input.estimated_tokens.tip')}</Text>
          <Text>{estimateTokenCount}</Text>
        </HStack>
      </VStack>
    )
  }

  return (
    <Container>
      <Popover content={PopoverContent}>
        <MenuOutlined /> {contextCount}
        <Divider type="vertical" style={{ marginTop: 0, marginLeft: 5, marginRight: 5 }} />
        <ArrowUpOutlined />
        {inputTokenCount} / {estimateTokenCount}
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
  @media (max-width: 600px) {
    display: none;
  }
`

const Text = styled.div`
  font-size: 12px;
  color: var(--color-text-1);
`

export default TokenCount
