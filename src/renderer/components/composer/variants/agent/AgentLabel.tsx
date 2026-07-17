import { EntityAvatarIcon } from '@renderer/components/EntityAvatarIcon'
import { cn } from '@renderer/utils/style'
import type { EntityAvatar } from '@shared/data/types/entityAvatar'

export type AgentLabelProps = {
  agent: { name?: string; avatar: EntityAvatar } | undefined | null
  avatarSize?: number
  classNames?: {
    container?: string
    avatar?: string
    name?: string
  }
  hideIcon?: boolean
}

export const AgentLabel = ({ agent, avatarSize = 24, classNames, hideIcon }: AgentLabelProps) => {
  return (
    <div className={cn('flex w-full items-center gap-2 truncate', classNames?.container)}>
      {!hideIcon && agent ? (
        <EntityAvatarIcon avatar={agent.avatar} className={classNames?.avatar} size={avatarSize} />
      ) : null}
      <span className={cn('truncate', 'text-foreground', classNames?.name)}>{agent?.name ?? ''}</span>
    </div>
  )
}
