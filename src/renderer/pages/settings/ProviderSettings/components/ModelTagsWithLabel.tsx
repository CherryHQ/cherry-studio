import { getModelDisplayTags, ModelTag } from '@renderer/components/Tags/Model'
import type { Model } from '@shared/data/types/model'
import type { FC } from 'react'
import { memo } from 'react'

export type ModelTagsWithLabelModel = Pick<Model, 'id' | 'name' | 'providerId' | 'capabilities' | 'endpointTypes'> &
  Partial<Pick<Model, 'description' | 'group'>>

interface ModelTagsProps {
  model: ModelTagsWithLabelModel
  showFree?: boolean
  showReasoning?: boolean
  showToolsCalling?: boolean
  size?: number
  showTooltip?: boolean
  style?: React.CSSProperties
}

const ModelTagsWithLabel: FC<ModelTagsProps> = ({
  model,
  showFree = true,
  showReasoning = true,
  showToolsCalling = true,
  size = 8,
  showTooltip = true,
  style
}) => {
  const tagProps = { size, showTooltip, showLabel: false }
  const tags = getModelDisplayTags(model, { showFree, showReasoning, showToolsCalling })

  return (
    <div className="flex min-w-0 max-w-full flex-row flex-wrap items-center gap-0.5 overflow-visible" style={style}>
      {tags.map((tag) => (
        <span key={tag} className="inline-flex">
          <ModelTag tag={tag} {...tagProps} />
        </span>
      ))}
    </div>
  )
}

export default memo(ModelTagsWithLabel)
