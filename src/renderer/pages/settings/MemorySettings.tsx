import { useTranslation } from 'react-i18next'

import { MemoryFileControls } from '@renderer/components/memory/MemoryFileControls'
import { SettingsContentColumn } from '@renderer/components/SettingsPrimitives'

export function MemorySettings() {
  const { t } = useTranslation()
  return (
    <SettingsContentColumn>
      <div className="space-y-4">
        <h2 className="font-semibold">{t('settings.memory.title')}</h2>
        <MemoryFileControls />
      </div>
    </SettingsContentColumn>
  )
}
