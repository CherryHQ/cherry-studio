import { Avatar, AvatarFallback } from '@cherrystudio/ui'
import { getModelLogo } from '@renderer/config/models'
import type { Model } from '@renderer/types'
import { cn } from '@renderer/utils'
import { first } from 'lodash'
import type { FC } from 'react'

interface Props {
  model?: Model
  size: number
  className?: string
}

const ModelAvatar: FC<Props> = ({ model, size, className }) => {
  const Icon = getModelLogo(model)
  if (Icon) {
    return <Icon.Avatar size={size} className={className} />
  }
  return (
    <Avatar
      className={cn('flex items-center justify-center rounded-lg', className)}
      style={{ width: size, height: size }}>
      <AvatarFallback className="rounded-lg">{first(model?.name)}</AvatarFallback>
    </Avatar>
  )
}

export default ModelAvatar
