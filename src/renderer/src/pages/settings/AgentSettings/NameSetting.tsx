import { EmojiAvatarWithPicker } from '@renderer/components/Avatar/EmojiAvatarWithPicker'
import type { AgentBaseWithId, UpdateAgentBaseForm, UpdateAgentFunctionUnion } from '@renderer/types'
import { AgentConfigurationSchema, isAgentEntity, isAgentType } from '@renderer/types'
import { Input } from 'antd'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingsItem, SettingsTitle } from './shared'

export interface NameSettingsProps {
  base: AgentBaseWithId | undefined | null
  update: UpdateAgentFunctionUnion
}

export const NameSetting = ({ base, update }: NameSettingsProps) => {
  const { t } = useTranslation()
  const [name, setName] = useState<string | undefined>(base?.name?.trim())

  const updateName = async (name: UpdateAgentBaseForm['name']) => {
    if (!base) return
    return update({ id: base.id, name: name?.trim() })
  }

  // Avatar logic
  const isAgent = isAgentEntity(base)
  const isDefault = isAgent ? isAgentType(base.configuration?.avatar) : false
  const [emoji, setEmoji] = useState(isAgent && !isDefault ? (base.configuration?.avatar ?? '⭐️') : '⭐️')

  const updateAvatar = useCallback(
    (avatar: string) => {
      if (!isAgent || !base) return
      const parsedConfiguration = AgentConfigurationSchema.parse(base.configuration ?? {})
      const payload = {
        id: base.id,
        configuration: {
          ...parsedConfiguration,
          avatar
        }
      }
      update(payload)
    },
    [base, update, isAgent]
  )

  if (!base) return null

  return (
    <SettingsItem inline>
      <SettingsTitle>{t('common.name')}</SettingsTitle>
      <div className="flex max-w-70 flex-1 items-center gap-1">
        {isAgent && (
          <EmojiAvatarWithPicker
            emoji={emoji}
            onPick={(emoji: string) => {
              setEmoji(emoji)
              if (isAgent && emoji === base?.configuration?.avatar) return
              updateAvatar(emoji)
            }}
          />
        )}
        <Input
          placeholder={t('common.agent_one') + t('common.name')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            if (name !== base.name) {
              updateName(name)
            }
          }}
          className="flex-1"
        />
      </div>
    </SettingsItem>
  )
}
