import EmojiIcon from '@renderer/components/EmojiIcon'
import { cn } from '@renderer/utils'
import type { AgentConfiguration } from '@shared/data/api/schemas/agents'

export type AgentLabelProps = {
  agent: { name?: string; configuration?: AgentConfiguration | null } | undefined | null
  classNames?: {
    container?: string
    avatar?: string
    name?: string
  }
  hideIcon?: boolean
}

export const AgentLabel = ({ agent, classNames, hideIcon }: AgentLabelProps) => {
  const emoji = agent?.configuration?.avatar || '⭐️'

  return (
    <div className={cn('flex w-full items-center gap-2 truncate', classNames?.container)}>
      {!hideIcon && <EmojiIcon emoji={emoji} className={classNames?.avatar} size={24} />}
      <span className={cn('truncate', 'text-(--color-foreground)', classNames?.name)}>{agent?.name ?? ''}</span>
    </div>
  )
}
