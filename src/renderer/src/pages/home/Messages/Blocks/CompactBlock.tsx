import { MessageBlockStatus } from '@renderer/types/newMessage'
import type { CollapseProps } from 'antd'
import { Collapse } from 'antd'
import { ChevronDown } from 'lucide-react'
import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import type { MarkdownSource } from '../../Markdown/Markdown'
import Markdown from '../../Markdown/Markdown'

interface Props {
  /** Stable ID for heading prefix */
  id: string
  /** Summary content (markdown) */
  content: string
  /** Original compacted content */
  compactedContent: string
}

const CompactBlock: React.FC<Props> = ({ id, content, compactedContent }) => {
  const { t } = useTranslation()

  const markdownSource = useMemo<MarkdownSource>(
    () => ({ id, content, status: MessageBlockStatus.SUCCESS }),
    [id, content]
  )

  const items: CollapseProps['items'] = [
    {
      key: 'summary',
      label: (
        <TitleWrapper>
          <TitleIcon>📦</TitleIcon>
          <TitleText>{t('message.message.compact.title')}</TitleText>
        </TitleWrapper>
      ),
      children: (
        <SummaryContent>
          <Markdown block={markdownSource} />
        </SummaryContent>
      )
    }
  ]

  return (
    <Container>
      <StyledCollapse items={items} expandIcon={() => <ChevronDown size={16} />} />

      {compactedContent && (
        <CompactedContentWrapper>
          <CompactedText>{compactedContent}</CompactedText>
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

const StyledCollapse = styled(Collapse)`
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
