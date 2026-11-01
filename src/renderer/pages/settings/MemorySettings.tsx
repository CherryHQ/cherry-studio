import { useTranslation } from 'react-i18next'

import { MemoryDreamingControls } from '@renderer/components/memory/MemoryDreamingControls'
import { MemoryFileControls } from '@renderer/components/memory/MemoryFileControls'
import {
  SettingDivider,
  SettingGroup,
  SettingsContentColumn,
  SettingTitle
} from '@renderer/components/SettingsPrimitives'

export function MemorySettings() {
  const { t } = useTranslation()
  return (
    <SettingsContentColumn>
      <SettingGroup>
        <SettingTitle role="heading" aria-level={2}>
          {t('settings.memory.title')}
        </SettingTitle>
        <SettingDivider />
        <MemoryDreamingControls scope={{ kind: 'shared' }} />
        <SettingDivider />
        <MemoryFileControls />
      </SettingGroup>
    </SettingsContentColumn>
  )
}
