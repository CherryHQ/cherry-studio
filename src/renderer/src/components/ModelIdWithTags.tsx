import type { Model } from '@renderer/types'
import { memo } from 'react'
import styled from 'styled-components'

import ModelTagsWithLabel from './ModelTagsWithLabel'

interface ModelIdWithTagsProps {
  model: Model
  fontSize?: number
  showIdentifier?: boolean
  style?: React.CSSProperties
}

const ModelIdWithTags = ({
  ref,
  model,
  fontSize = 14,
  showIdentifier = false,
  style
}: ModelIdWithTagsProps & { ref?: React.RefObject<HTMLDivElement> | null }) => {
  const shouldShowIdentifier = showIdentifier && model.id !== model.name

  return (
    <ListItemName ref={ref} $fontSize={fontSize} style={style}>
      <NameBlock>
        <NameSpan>{model.name}</NameSpan>
        {shouldShowIdentifier && <IdentifierSpan title={model.id}>{model.id}</IdentifierSpan>}
      </NameBlock>
      <ModelTagsWithLabel model={model} size={11} style={{ flexShrink: 0 }} />
    </ListItemName>
  )
}

const ListItemName = styled.div<{ $fontSize?: number }>`
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  color: var(--color-text);
  line-height: 1.2;
  font-weight: 600;
  font-size: ${(props) => props.$fontSize}px;
`

const NameBlock = styled.div`
  display: flex;
  flex: 1;
  align-items: center;
  gap: 8px;
  min-width: 0;
`

const NameSpan = styled.span`
  display: block;
  flex-shrink: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.3;
`

const IdentifierSpan = styled.span`
  flex-shrink: 1;
  max-width: 50%;
  min-width: 0;
  overflow: hidden;
  color: var(--color-text-3);
  font-family: monospace;
  font-size: 12px;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
`

export default memo(ModelIdWithTags)
