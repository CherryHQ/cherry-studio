import { EmojiAvatarWithPicker } from '@renderer/components/Avatar/EmojiAvatarWithPicker'
import type {
  AgentBaseWithId,
  UpdateAgentBaseForm,
  UpdateAgentFunctionUnion,
  UpdateAgentSessionFunction
} from '@renderer/types'
import { AgentConfigurationSchema, isAgentEntity, isAgentType } from '@renderer/types'
import { Input } from 'antd'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingsItem, SettingsTitle } from '../shared'

export interface NameSettingsProps {
  base: AgentBaseWithId | undefined | null
  update: UpdateAgentFunctionUnion
}

export const NameSetting = ({ base, update }: NameSettingsProps) => {
  const { t } = useTranslation()
  const [name, setName] = useState<string | undefined>(base?.name?.trim())

  const updateName = async (name: UpdateAgentBaseForm['name']) => {
    if (!base) return
    const trimmed = name?.trim()
    // A user-typed session name is a manual rename; flag it so the auto-namer
    // won't overwrite it later. Agents have no such flag.
    if (isAgentEntity(base)) {
      return update({ id: base.id, name: trimmed })
    }
    return (update as UpdateAgentSessionFunction)({ id: base.id, name: trimmed, name_manually_edited: true })
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
      void update(payload)
    },
    [base, update, isAgent]
  )

  if (!base) return null

  return (
    <>
      {isAgent && (
        <SettingsItem inline>
          <SettingsTitle>{t('common.avatar')}</SettingsTitle>
          <EmojiAvatarWithPicker
            emoji={emoji}
            onPick={(emoji: string) => {
              setEmoji(emoji)
              if (isAgent && emoji === base?.configuration?.avatar) return
              updateAvatar(emoji)
            }}
          />
        </SettingsItem>
      )}
      <SettingsItem inline>
        <SettingsTitle>{t('common.name')}</SettingsTitle>
        <div className="relative flex flex-1 justify-end">
          <span className="invisible whitespace-pre px-[11px] py-1">
            {name || t('common.agent_one') + t('common.name')}
          </span>
          <Input
            placeholder={t('common.agent_one') + t('common.name')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              if (name !== base.name) {
                void updateName(name)
              }
            }}
            className="absolute right-0"
            style={{ width: '100%', maxWidth: 'fit-content', textAlign: 'center' }}
          />
        </div>
      </SettingsItem>
    </>
  )
}
