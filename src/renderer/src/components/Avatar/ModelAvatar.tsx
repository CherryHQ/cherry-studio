import type { AvatarProps } from '@cherrystudio/ui'
import { Avatar, cn } from '@cherrystudio/ui'
import { getModelLogo } from '@renderer/config/models'
import type { Model } from '@renderer/types'
import { first } from 'lodash'
import type { FC } from 'react'

interface Props {
  model?: Model
  size: number
  props?: AvatarProps
  className?: string
}

const ModelAvatar: FC<Props> = ({ model, size, className, ...props }) => {
  return (
    <Avatar
      src={getModelLogo(model?.id || '')}
      radius="lg"
      className={cn('flex items-center justify-center', `${className || ''}`)}
      style={{ width: size, height: size }}
      {...props}>
      {first(model?.name)}
    </Avatar>
  )
}

export default ModelAvatar
