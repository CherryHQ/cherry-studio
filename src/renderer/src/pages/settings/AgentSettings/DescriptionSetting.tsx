import type { AgentBaseWithId, UpdateAgentBaseForm, UpdateAgentFunctionUnion } from '@renderer/types'
import TextArea from 'antd/es/input/TextArea'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingsItem, SettingsTitle } from './shared'

export interface DescriptionSettingProps {
  base: AgentBaseWithId | undefined | null
  update: UpdateAgentFunctionUnion
}

export const DescriptionSetting = ({ base, update }: DescriptionSettingProps) => {
  const { t } = useTranslation()
  const [description, setDescription] = useState<string | undefined>(base?.description?.trim())

  const updateDesc = useCallback(
    (description: UpdateAgentBaseForm['description']) => {
      if (!base) return
      update({ id: base.id, description })
    },
    [base, update]
  )
  if (!base) return null

  return (
    <SettingsItem divider={false}>
      <SettingsTitle>{t('common.description')}</SettingsTitle>
      <TextArea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={4}
        onBlur={() => {
          if (description !== base.description) {
            updateDesc(description)
          }
        }}
      />
    </SettingsItem>
  )
}
