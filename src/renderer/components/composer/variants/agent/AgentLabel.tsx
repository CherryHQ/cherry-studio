import EmojiIcon from '@renderer/components/EmojiIcon'
import { getAgentAvatarFromConfiguration } from '@renderer/utils/agent'
import { cn } from '@renderer/utils/style'
import type { AgentConfiguration } from '@shared/data/api/schemas/agents'

export type AgentLabelProps = {
  agent: { name?: string; configuration?: AgentConfiguration | null } | undefined | null
  avatarSize?: number
  classNames?: {
    container?: string
    avatar?: string
    name?: string
  }
  hideIcon?: boolean
}

export const AgentLabel = ({ agent, avatarSize = 24, classNames, hideIcon }: AgentLabelProps) => {
  const emoji = getAgentAvatarFromConfiguration(agent?.configuration)

  return (
    <div className={cn('flex w-full items-center gap-2 truncate', classNames?.container)}>
      {!hideIcon && <EmojiIcon emoji={emoji} className={classNames?.avatar} size={avatarSize} />}
      <span className={cn('truncate', 'text-foreground', classNames?.name)}>{agent?.name ?? ''}</span>
    </div>
  )
}
