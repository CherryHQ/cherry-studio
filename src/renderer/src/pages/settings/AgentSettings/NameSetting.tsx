import { Input } from '@heroui/react'
import { AgentBaseWithId, UpdateAgentBaseForm } from '@renderer/types'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingsItem, SettingsTitle } from './shared'

export interface NameSettingsProps {
  base: AgentBaseWithId | undefined | null
  update: (form: UpdateAgentBaseForm) => Promise<void>
}

export const NameSetting: React.FC<NameSettingsProps> = ({ base, update }) => {
  const { t } = useTranslation()
  const [name, setName] = useState<string | undefined>(base?.name?.trim())
  const updateName = async (name: UpdateAgentBaseForm['name']) => {
    if (!base) return
    return update({ id: base.id, name: name?.trim() })
  }
  if (!base) return null

  return (
    <SettingsItem inline>
      <SettingsTitle>{t('common.name')}</SettingsTitle>
      <Input
        placeholder={t('common.agent_one') + t('common.name')}
        value={name}
        size="sm"
        onValueChange={(value) => setName(value)}
        onBlur={() => {
          if (name !== base.name) {
            updateName(name)
          }
        }}
        className="max-w-80 flex-1"
      />
    </SettingsItem>
  )
}
