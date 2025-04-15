import { InfoCircleOutlined } from '@ant-design/icons'
import Favicon from '@renderer/components/Icons/FallbackFavicon'
import { HStack } from '@renderer/components/Layout'
import React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Citation {
  number: number
  url: string
  title?: string
  hostname?: string
  showFavicon?: boolean
}

interface CitationsListProps {
  citations: Citation[]
}

const CitationsList: React.FC<CitationsListProps> = ({ citations }) => {
  const { t } = useTranslation()

  if (!citations || citations.length === 0) return null

  return (
    <CitationsContainer className="footnotes">
      <CitationsTitle>
        {t('message.citations')}
        <InfoCircleOutlined style={{ fontSize: '14px', marginLeft: '4px', opacity: 0.6 }} />
      </CitationsTitle>
      {citations.map((citation) => (
        <HStack key={citation.url || citation.number} style={{ alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, color: 'var(--color-text-2)' }}>{citation.number}.</span>
          {citation.showFavicon && citation.url && (
            <Favicon hostname={new URL(citation.url).hostname} alt={citation.title || citation.hostname || ''} />
          )}
          <CitationLink href={citation.url} className="text-nowrap" target="_blank" rel="noopener noreferrer">
            {citation.title ? citation.title : <span className="hostname">{citation.hostname}</span>}
          </CitationLink>
        </HStack>
      ))}
    </CitationsContainer>
  )
}

const CitationsContainer = styled.div`
  background-color: rgb(242, 247, 253);
  border-radius: 4px;
  padding: 8px 12px;
  margin: 12px 0;
  display: flex;
  flex-direction: column;
  gap: 4px;

  body[theme-mode='dark'] & {
    background-color: rgba(255, 255, 255, 0.05);
  }
`

const CitationsTitle = styled.div`
  font-weight: 500;
  margin-bottom: 4px;
  color: var(--color-text-1);
`

const CitationLink = styled.a`
  font-size: 14px;
  line-height: 1.6;
  text-decoration: none;
  color: var(--color-text-1);

  .hostname {
    color: var(--color-link);
  }

  &:hover {
    text-decoration: underline;
  }
`

export default CitationsList
