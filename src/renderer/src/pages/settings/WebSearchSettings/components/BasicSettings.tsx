import { InfoTooltip, Switch } from '@cherrystudio/ui'
import { useTheme } from '@renderer/context/ThemeProvider'
import { SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '@renderer/pages/settings'
import { Slider } from 'antd'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { useWebSearchSettings } from '../hooks/useWebSearchSettings'

const BasicSettings: FC = () => {
  const { theme } = useTheme()
  const { t } = useTranslation()
  const { compressionConfig, maxResults, searchWithTime, setMaxResults, setSearchWithTime } = useWebSearchSettings()

  return (
    <SettingGroup theme={theme} style={{ paddingBottom: 8 }}>
      <SettingTitle>{t('settings.general.title')}</SettingTitle>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.tool.websearch.search_with_time')}</SettingRowTitle>
        <Switch checked={searchWithTime} onCheckedChange={setSearchWithTime} />
      </SettingRow>
      <SettingDivider style={{ marginTop: 15, marginBottom: 10 }} />
      <SettingRow style={{ height: 40 }}>
        <SettingRowTitle style={{ minWidth: 120 }}>
          {t('settings.tool.websearch.search_max_result.label')}
          {maxResults > 20 && compressionConfig?.method === 'none' && (
            <InfoTooltip
              content={t('settings.tool.websearch.search_max_result.tooltip')}
              iconProps={{ size: 16, color: 'var(--color-icon)', className: 'ml-1 cursor-pointer' }}
            />
          )}
        </SettingRowTitle>
        <Slider
          defaultValue={maxResults}
          style={{ width: '100%' }}
          min={1}
          max={100}
          step={1}
          marks={{ 1: '1', 5: '5', 20: '20', 50: '50', 100: '100' }}
          onChangeComplete={setMaxResults}
        />
      </SettingRow>
    </SettingGroup>
  )
}

export default BasicSettings
