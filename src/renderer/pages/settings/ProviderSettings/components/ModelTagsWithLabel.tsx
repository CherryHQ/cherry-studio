import type { FC } from 'react'
import { memo } from 'react'

import { getModelDisplayTags, ModelTag } from '@renderer/components/tags/Model'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

export type ModelTagsWithLabelModel = Pick<
  Model,
  'id' | 'name' | 'providerId' | 'capabilities' | 'inputModalities' | 'endpointTypes'
> &
  Partial<Pick<Model, 'description' | 'group'>>

interface ModelTagsProps {
  model: ModelTagsWithLabelModel
  provider?: Provider
  showFree?: boolean
  showReasoning?: boolean
  showToolsCalling?: boolean
  size?: number
  showTooltip?: boolean
  style?: React.CSSProperties
}

const ModelTagsWithLabel: FC<ModelTagsProps> = ({
  model,
  provider,
  showFree = true,
  showReasoning = true,
  showToolsCalling = true,
  size = 8,
  showTooltip = true,
  style
}) => {
  const tagProps = { size, showTooltip, showLabel: false }
  const tags = getModelDisplayTags(model, { showFree, showReasoning, showToolsCalling }, provider)

  return (
    <div className="flex max-w-full min-w-0 flex-row flex-wrap items-center gap-0.5 overflow-visible" style={style}>
      {tags.map((tag) => (
        <span key={tag} className="inline-flex">
          <ModelTag tag={tag} {...tagProps} />
        </span>
      ))}
    </div>
  )
}

export default memo(ModelTagsWithLabel)
