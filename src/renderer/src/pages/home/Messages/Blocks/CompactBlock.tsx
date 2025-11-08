import { Accordion, AccordionItem } from '@heroui/react'
import type { CompactMessageBlock } from '@renderer/types/newMessage'
import { ChevronDown } from 'lucide-react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import Markdown from '../../Markdown/Markdown'

interface Props {
  block: CompactMessageBlock
}

const CompactBlock: React.FC<Props> = ({ block }) => {
  const { t } = useTranslation()
  return (
    <Container>
      <StyledAccordion>
        <AccordionItem
          key="summary"
          aria-label="Compact Summary"
          title={
            <TitleWrapper>
              <TitleIcon>📦</TitleIcon>
              <TitleText>{t('message.message.compact.title')}</TitleText>
            </TitleWrapper>
          }
          indicator={<ChevronDown size={16} />}>
          <SummaryContent>
            <Markdown block={block} />
          </SummaryContent>
        </AccordionItem>
      </StyledAccordion>

      {block.compactedContent && (
        <CompactedContentWrapper>
          <CompactedText>{block.compactedContent}</CompactedText>
        </CompactedContentWrapper>
      )}
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 8px 0;
`

const StyledAccordion = styled(Accordion).attrs({
  variant: 'bordered'
})`
  border-radius: 8px;
`

const TitleWrapper = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

const TitleIcon = styled.span`
  font-size: 18px;
`

const TitleText = styled.span`
  font-weight: 500;
  font-size: 14px;
  color: var(--color-text-1);
`

const SummaryContent = styled.div`
  padding: 8px 0;
  color: var(--color-text-2);
  font-size: 14px;
  line-height: 1.6;
`

const CompactedContentWrapper = styled.div`
  margin-top: 8px;
`

const CompactedText = styled.div`
  font-size: 14px;
  color: var(--color-text-2);
  white-space: pre-wrap;
  line-height: 1.6;
`

export default React.memo(CompactBlock)
