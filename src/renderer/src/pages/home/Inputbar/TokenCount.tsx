import { usePreference } from '@data/hooks/usePreference'
import { ColFlex, RowFlex } from '@renderer/components/Layout'
import MaxContextCount from '@renderer/components/MaxContextCount'
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
  const [showInputEstimatedTokens] = usePreference('chat.input.show_estimated_tokens')

  if (!showInputEstimatedTokens) {
    return null
  }

  const PopoverContent = () => {
    return (
      <ColFlex className="w-full" style={{ width: '185px', background: '100%' }}>
        <RowFlex className="w-full justify-between">
          <Text>{t('chat.input.context_count.tip')}</Text>
          <Text>
            <RowFlex style={{ alignItems: 'center' }}>
              {contextCount.current}
              <SlashSeparatorSpan>/</SlashSeparatorSpan>
              <MaxContextCount maxContext={contextCount.max} />
            </RowFlex>
          </Text>
        </RowFlex>
        <Divider style={{ margin: '5px 0' }} />
        <RowFlex className="w-full justify-between">
          <Text>{t('chat.input.estimated_tokens.tip')}</Text>
          <Text>{estimateTokenCount}</Text>
        </RowFlex>
      </ColFlex>
    )
  }

  return (
    <Container>
      <Popover content={PopoverContent} arrow={false}>
        <RowFlex>
          <RowFlex className="items-center">
            <MenuIcon size={12} className="icon" />
            {contextCount.current}
            <SlashSeparatorSpan>/</SlashSeparatorSpan>
            <MaxContextCount maxContext={contextCount.max} />
          </RowFlex>
          <Divider type="vertical" style={{ marginTop: 3, marginLeft: 5, marginRight: 3 }} />
          <RowFlex className="items-center">
            <ArrowUp size={12} className="icon" />
            {inputTokenCount}
            <SlashSeparatorSpan>/</SlashSeparatorSpan>
            {estimateTokenCount}
          </RowFlex>
        </RowFlex>
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
