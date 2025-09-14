import { Model } from '@renderer/types'
import { Tooltip, Typography } from 'antd'
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
        styles={{
          root: {
            width: 'auto',
            maxWidth: '500px'
          }
        }}
        destroyOnHidden
        title={
          <Typography.Text style={{ color: 'white' }} copyable={{ text: model.id }}>
            {model.id}
          </Typography.Text>
        }
        mouseEnterDelay={0.5}
        placement="top">
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
