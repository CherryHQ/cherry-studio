import { InfoTooltip, Slider, Switch } from '@cherrystudio/ui'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useWebSearchSettings } from '@renderer/hooks/useWebSearch'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '..'

const BasicSettings: FC = () => {
  const { theme } = useTheme()
  const { t } = useTranslation()
  const { searchWithTime, maxResults, compressionMethod, setSearchWithTime, setMaxResults } = useWebSearchSettings()

  return (
    <SettingGroup theme={theme} style={{ paddingBottom: 8 }}>
      <SettingTitle>{t('settings.general.title')}</SettingTitle>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.tool.websearch.search_with_time')}</SettingRowTitle>
        <Switch checked={searchWithTime} onCheckedChange={(checked) => setSearchWithTime(checked)} />
      </SettingRow>
      <SettingDivider style={{ marginTop: 15, marginBottom: 10 }} />
      <SettingRow style={{ height: 40 }}>
        <SettingRowTitle style={{ minWidth: 120 }}>
          {t('settings.tool.websearch.search_max_result.label')}
          {maxResults > 20 && compressionMethod === 'none' && (
            <InfoTooltip
              content={t('settings.tool.websearch.search_max_result.tooltip')}
              iconProps={{ size: 16, color: 'var(--color-icon)', className: 'ml-1 cursor-pointer' }}
            />
          )}
        </SettingRowTitle>
        <Slider
          defaultValue={[maxResults]}
          className="w-full"
          min={1}
          max={100}
          step={1}
          marks={[
            { value: 1, label: '1' },
            { value: 5, label: '5' },
            { value: 20, label: '20' },
            { value: 50, label: '50' },
            { value: 100, label: '100' }
          ]}
          onValueChange={(values) => setMaxResults(values[0])}
        />
      </SettingRow>
    </SettingGroup>
  )
}

export default BasicSettings
