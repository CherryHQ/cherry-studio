import { EmojiAvatarWithPicker } from '@renderer/components/Avatar/EmojiAvatarWithPicker'
import { AgentConfigurationSchema, AgentEntity, isAgentType, UpdateAgentForm } from '@renderer/types'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingsItem, SettingsTitle } from './shared'

export interface AvatarSettingsProps {
  agent: AgentEntity
  update: (form: UpdateAgentForm) => Promise<AgentEntity | undefined>
}

// const logger = loggerService.withContext('AvatarSetting')

export const AvatarSetting: React.FC<AvatarSettingsProps> = ({ agent, update }) => {
  const { t } = useTranslation()
  const isDefault = isAgentType(agent.configuration?.avatar)
  const [emoji, setEmoji] = useState(isDefault ? '⭐️' : (agent.configuration?.avatar ?? '⭐️'))

  const updateAvatar = useCallback(
    (avatar: string) => {
      const parsedConfiguration = AgentConfigurationSchema.parse(agent.configuration ?? {})
      const payload = {
        id: agent.id,
        configuration: {
          ...parsedConfiguration,
          avatar
        }
      } satisfies UpdateAgentForm
      update(payload)
    },
    [agent, update]
  )

  return (
    <SettingsItem inline>
      <SettingsTitle>{t('common.avatar')}</SettingsTitle>
      <EmojiAvatarWithPicker
        emoji={emoji}
        onPick={(emoji: string) => {
          setEmoji(emoji)
          if (emoji === agent?.configuration?.avatar) return
          updateAvatar(emoji)
        }}
      />
    </SettingsItem>
  )
}
