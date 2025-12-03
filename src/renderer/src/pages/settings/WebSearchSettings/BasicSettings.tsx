import { Switch } from '@cherrystudio/ui'
import { InfoTooltip } from '@cherrystudio/ui'
import { Slider } from '@cherrystudio/ui'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useWebSearchSettings } from '@renderer/hooks/useWebSearchProviders'
import { useAppDispatch } from '@renderer/store'
import { setMaxResult, setSearchWithTime } from '@renderer/store/websearch'
import { t } from 'i18next'
import type { FC } from 'react'

import { SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '..'

const BasicSettings: FC = () => {
  const { theme } = useTheme()
  const { searchWithTime, maxResults, compressionConfig } = useWebSearchSettings()

  const dispatch = useAppDispatch()

  return (
    <>
      <SettingGroup theme={theme} style={{ paddingBottom: 8 }}>
        <SettingTitle>{t('settings.general.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.tool.websearch.search_with_time')}</SettingRowTitle>
          <Switch checked={searchWithTime} onCheckedChange={(checked) => dispatch(setSearchWithTime(checked))} />
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
            defaultValue={[maxResults]}
            className="w-60"
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
            onValueCommit={(values) => dispatch(setMaxResult(values[0]))}
            showValueLabel
          />
        </SettingRow>
      </SettingGroup>
    </>
  )
}
export default BasicSettings
