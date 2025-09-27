import { Avatar, Radio, RadioGroup } from '@heroui/react'
import { loggerService } from '@logger'
import { EmojiAvatarWithPicker } from '@renderer/components/Avatar/EmojiAvatarWithPicker'
import { getAgentDefaultAvatar } from '@renderer/config/agent'
import { AgentEntity, isAgentType, UpdateAgentForm } from '@renderer/types'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import z from 'zod'

import { SettingsItem, SettingsTitle } from './shared'

export interface AvatarSettingsProps {
  agent: AgentEntity
  update: (form: UpdateAgentForm) => Promise<void>
}

const optionsSchema = z.enum(['default', 'emoji'])

type AvatarOption = z.infer<typeof optionsSchema>

const options = {
  DEFAULT: 'default',
  EMOJI: 'emoji'
} as const satisfies Record<string, AvatarOption>

const logger = loggerService.withContext('AvatarSetting')

export const AvatarSetting: React.FC<AvatarSettingsProps> = ({ agent, update }) => {
  const { t } = useTranslation()
  const isDefault = isAgentType(agent.configuration?.avatar)
  const [avatarOption, setAvatarOption] = useState<AvatarOption>(isDefault ? options.DEFAULT : options.EMOJI)
  const [emoji, setEmoji] = useState(isDefault ? '⭐️' : (agent.configuration?.avatar ?? '⭐️'))

  const updateAvatar = useCallback(
    (avatar: string) => {
      const payload = {
        id: agent.id,
        // hard-encoded default values. better to implement incremental update for configuration
        configuration: {
          ...agent.configuration,
          permission_mode: agent.configuration?.permission_mode ?? 'default',
          max_turns: agent.configuration?.max_turns ?? 100,
          avatar
        }
      } satisfies UpdateAgentForm
      update(payload)
    },
    [agent, update]
  )

  const handleOptionChange = useCallback(
    (value: string) => {
      const result = optionsSchema.safeParse(value)
      if (!result.success) {
        logger.error('Invalid option', { value })
        return
      }
      const option = result.data
      setAvatarOption(option)
      if (option === agent?.configuration?.avatar) return

      switch (option) {
        case options.DEFAULT:
          updateAvatar(agent.type)
          break
        case options.EMOJI:
          updateAvatar(emoji)
          break
        default:
          break
      }
    },
    [agent?.configuration?.avatar, agent.type, emoji, updateAvatar]
  )

  return (
    <SettingsItem inline>
      <SettingsTitle>{t('common.avatar')}</SettingsTitle>
      <RadioGroup size="sm" orientation="horizontal" value={avatarOption} onValueChange={handleOptionChange}>
        <Radio value={options.DEFAULT} classNames={{ label: 'flex flex-row' }}>
          <Avatar className="h-6 w-6" src={getAgentDefaultAvatar(agent.type)} />
        </Radio>
        <Radio value={options.EMOJI}>
          <EmojiAvatarWithPicker
            emoji={emoji}
            onPick={(emoji: string) => {
              setEmoji(emoji)
              if (emoji === agent?.configuration?.avatar) return
              updateAvatar(emoji)
            }}
          />
        </Radio>
      </RadioGroup>
    </SettingsItem>
  )
}
