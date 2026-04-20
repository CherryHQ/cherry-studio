import type { Model } from '@renderer/types'
import { memo } from 'react'

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
    <div
      ref={ref}
      className="flex min-w-0 items-center gap-2.5 font-semibold text-(--color-text) leading-[1.2]"
      style={{ fontSize, ...style }}>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="block min-w-0 shrink overflow-hidden text-ellipsis whitespace-nowrap leading-[1.3]">
          {model.name}
        </span>
        {shouldShowIdentifier && (
          <span
            className="min-w-0 max-w-[50%] shrink truncate font-mono text-(--color-text-3) text-[12px]! leading-[1.2]"
            title={model.id}>
            {model.id}
          </span>
        )}
      </div>
      <ModelTagsWithLabel model={model} size={11} style={{ flexShrink: 0 }} />
    </div>
  )
}

export default memo(ModelIdWithTags)
