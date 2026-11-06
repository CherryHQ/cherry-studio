import { useTranslation } from 'react-i18next'

import { EmojiIcon } from '@cherrystudio/ui'
import { LocalAgentIcon } from '@renderer/components/icons/LocalAgentIcon'
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
  const { t } = useTranslation()
  const emoji = getAgentAvatarFromConfiguration(agent?.configuration)

  return (
    <div className={cn('flex w-full items-center gap-2 truncate', classNames?.container)}>
      {!hideIcon &&
        (agent?.configuration?.localRuntime ? (
          <LocalAgentIcon
            presetId={agent.configuration.localRuntime.presetId}
            size={avatarSize}
            className={classNames?.avatar}
          />
        ) : (
          <EmojiIcon emoji={emoji} className={classNames?.avatar} size={avatarSize} />
        ))}
      <span className={cn('truncate', 'text-foreground', classNames?.name)}>{agent?.name ?? ''}</span>
      {agent?.configuration?.localRuntime && (
        <span className="rounded bg-muted px-1 text-xs text-muted-foreground">{t('local_agents.badge')}</span>
      )}
    </div>
  )
}
