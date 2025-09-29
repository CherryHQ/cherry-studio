import type { AvatarProps } from '@cherrystudio/ui'
import { Avatar, cn } from '@cherrystudio/ui'
import { getModelLogo } from '@renderer/config/models'
import type { Model } from '@renderer/types'
import { first } from 'lodash'
import type { FC } from 'react'

interface Props {
  model: Model
  size: number
  props?: AvatarProps
  className?: string
}

const ModelAvatar: FC<Props> = ({ model, size, className, ...props }) => {
  const classNames = cn('flex items-center justify-center', `h-[${size}px] w-[${size}px]`, `${className || ''}`)
  return (
    <Avatar src={getModelLogo(model?.id || '')} {...props} className={classNames}>
      {first(model?.name)}
    </Avatar>
  )
}

export default ModelAvatar
