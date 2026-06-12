import { Avatar, AvatarFallback } from '@cherrystudio/ui'
import { getModelLogo } from '@renderer/config/models'
import { cn } from '@renderer/utils'
import { first } from 'lodash'
import type { FC } from 'react'

/**
 * Structural minimum the avatar needs. `getModelLogo` is shape-agnostic
 * (accepts both v1 `provider` and v2 `providerId`), so this component works
 * with either Model shape — no v1 `@renderer/types` dependency.
 */
interface AvatarModel {
  id: string
  name: string
  provider?: string
  providerId?: string
}

interface Props {
  model?: AvatarModel
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
