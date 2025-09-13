import { Tooltip } from '@heroui/react'
import CopyButton from '@renderer/components/CopyButton'
import { Model } from '@renderer/types'
import { memo } from 'react'
import styled from 'styled-components'

import ModelTagsWithLabel from './ModelTagsWithLabel'

interface ModelIdWithTagsProps {
  model: Model
  fontSize?: number
  style?: React.CSSProperties
}

const ModelIdWithTags = ({
  ref,
  model,
  fontSize = 14,
  style
}: ModelIdWithTagsProps & { ref?: React.RefObject<HTMLDivElement> | null }) => {
  return (
    <ListItemName ref={ref} $fontSize={fontSize} style={style}>
      <Tooltip
        classNames={{
          content: 'w-auto max-w-lg'
        }}
        content={
          <div style={{ color: 'white', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>{model.id}</span>
            <CopyButton textToCopy={model.id} size={12} />
          </div>
        }
        closeDelay={500}
        placement="top"
        showArrow={true}>
        <NameSpan>{model.name}</NameSpan>
      </Tooltip>
      <ModelTagsWithLabel model={model} size={11} style={{ flexShrink: 0 }} />
    </ListItemName>
  )
}

const ListItemName = styled.div<{ $fontSize?: number }>`
  display: flex;
  align-items: center;
  flex-direction: row;
  gap: 10px;
  color: var(--color-text);
  line-height: 1;
  font-weight: 600;
  font-size: ${(props) => props.$fontSize}px;
`

const NameSpan = styled.span`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: help;
  line-height: 30px;
`

export default memo(ModelIdWithTags)
