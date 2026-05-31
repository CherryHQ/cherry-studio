import { Button, Tooltip } from 'antd'
import { Download, ExternalLink, Star } from 'lucide-react'
import React, { type FC, memo } from 'react'
import styled from 'styled-components'

import type { SkillSearchResult } from './types'

const INSTALL_BTN_STYLE = { fontSize: 11, height: 22 } as const

interface SearchResultRowProps {
  result: SkillSearchResult
  isInstalling: (source?: string) => boolean
  onInstall: (result: SkillSearchResult) => void
  onPreview: (result: SkillSearchResult) => void
  installLabel: string
}

export const SearchResultRow: FC<SearchResultRowProps> = memo(
  ({ result, isInstalling, onInstall, onPreview, installLabel }) => (
    <SearchResultItem>
      <ResultInfo onClick={() => onPreview(result)}>
        <ResultName>{result.name}</ResultName>
        <ResultMeta>
          {result.stars > 0 ? (
            <MetaBadge>
              <Star size={10} /> {result.stars}
            </MetaBadge>
          ) : null}
          {result.downloads > 0 ? (
            <MetaBadge>
              <Download size={10} /> {result.downloads}
            </MetaBadge>
          ) : null}
        </ResultMeta>
      </ResultInfo>
      <ResultActions>
        {result.sourceUrl ? (
          <Tooltip title={result.sourceRegistry}>
            <ExternalLinkButton
              onClick={(e) => {
                e.stopPropagation()
                window.open(result.sourceUrl!)
              }}>
              <ExternalLink size={12} />
            </ExternalLinkButton>
          </Tooltip>
        ) : null}
        <Button
          type="primary"
          size="small"
          icon={<Download size={12} />}
          loading={isInstalling(result.installSource)}
          onClick={() => onInstall(result)}
          style={INSTALL_BTN_STYLE}>
          {installLabel}
        </Button>
      </ResultActions>
    </SearchResultItem>
  )
)

SearchResultRow.displayName = 'SearchResultRow'

const SearchResultItem = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--color-border);
  &:hover {
    background: var(--color-background-soft);
  }
`

const ResultInfo = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  cursor: pointer;
  flex: 1;
  min-width: 0;
`

const ResultName = styled.div`
  font-size: 14px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const ResultMeta = styled.div`
  display: flex;
  gap: 8px;
  font-size: 12px;
  color: var(--color-text-3);
`

const MetaBadge = styled.span`
  display: flex;
  align-items: center;
  gap: 4px;
`

const ResultActions = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
`

const ExternalLinkButton = styled(Button)`
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
`
