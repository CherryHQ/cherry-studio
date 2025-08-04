import { HStack, VStack } from '@renderer/components/Layout'
import MaxContextCount from '@renderer/components/MaxContextCount'
import { useSettings } from '@renderer/hooks/useSettings'
import { Divider, Popover } from 'antd'
import { ArrowUp, MenuIcon } from 'lucide-react'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

type Props = {
  estimateTokenCount: number
  inputTokenCount: number
  contextCount: { current: number; max: number }
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
      <VStack w="185px" background="100%">
        <HStack justifyContent="space-between" w="100%">
          <Text>{t('chat.input.context_count.tip')}</Text>
          <Text>
            <HStack style={{ alignItems: 'center' }}>
              {contextCount.current}
              <SlashSeparatorSpan>/</SlashSeparatorSpan>
              <MaxContextCount maxContext={contextCount.max} />
            </HStack>
          </Text>
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
      <Popover content={PopoverContent} arrow={false}>
        <HStack>
          <HStack style={{ alignItems: 'center' }}>
            <MenuIcon size={12} className="icon" />
            {contextCount.current}
            <SlashSeparatorSpan>/</SlashSeparatorSpan>
            <MaxContextCount maxContext={contextCount.max} />
          </HStack>
          <Divider type="vertical" style={{ marginTop: 3, marginLeft: 5, marginRight: 3 }} />
          <HStack style={{ alignItems: 'center' }}>
            <ArrowUp size={12} className="icon" />
            {inputTokenCount}
            <SlashSeparatorSpan>/</SlashSeparatorSpan>
            {estimateTokenCount}
          </HStack>
        </HStack>
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
  border-radius: 20px;
  display: flex;
  align-items: center;
  cursor: pointer;
  .icon {
    margin-right: 3px;
  }
  @media (max-width: 800px) {
    display: none;
  }
`

const Text = styled.div`
  font-size: 12px;
  color: var(--color-text-1);
`

const SlashSeparatorSpan = styled.span`
  margin-left: 2px;
  margin-right: 2px;
`

export default TokenCount
