import { useTheme } from '@renderer/context/ThemeProvider'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { setContentLimit, setMaxResult, setSearchWithTime } from '@renderer/store/websearch'
import { Input, Slider, Switch, Tooltip } from 'antd'
import { t } from 'i18next'
import { Info } from 'lucide-react'
import { FC } from 'react'

import { SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '..'

const BasicSettings: FC = () => {
  const { theme } = useTheme()
  const searchWithTime = useAppSelector((state) => state.websearch.searchWithTime)
  const maxResults = useAppSelector((state) => state.websearch.maxResults)
  const contentLimit = useAppSelector((state) => state.websearch.contentLimit)

  const dispatch = useAppDispatch()

  return (
    <>
      <SettingGroup theme={theme} style={{ paddingBottom: 8 }}>
        <SettingTitle>{t('settings.general.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.websearch.search_with_time')}</SettingRowTitle>
          <Switch checked={searchWithTime} onChange={(checked) => dispatch(setSearchWithTime(checked))} />
        </SettingRow>
        <SettingDivider style={{ marginTop: 15, marginBottom: 10 }} />
        <SettingRow style={{ height: 40 }}>
          <SettingRowTitle>{t('settings.websearch.search_max_result')}</SettingRowTitle>
          <Slider
            defaultValue={maxResults}
            style={{ width: '200px' }}
            min={1}
            max={20}
            step={1}
            marks={{ 1: '1', 5: t('settings.websearch.search_result_default'), 20: '20' }}
            onChangeComplete={(value) => dispatch(setMaxResult(value))}
          />
        </SettingRow>
        <SettingDivider style={{ marginTop: 15, marginBottom: 10 }} />
        <SettingRow>
          <SettingRowTitle>
            {t('settings.websearch.content_limit')}
            <Tooltip title={t('settings.websearch.content_limit_tooltip')} placement="right">
              <Info size={16} color="var(--color-icon)" style={{ marginLeft: 5, cursor: 'pointer' }} />
            </Tooltip>
          </SettingRowTitle>
          <Input
            style={{ width: '100px' }}
            placeholder="2000"
            value={contentLimit === undefined ? '' : contentLimit}
            onChange={(e) => {
              const value = e.target.value
              if (value === '') {
                dispatch(setContentLimit(undefined))
              } else if (!isNaN(Number(value)) && Number(value) > 0) {
                dispatch(setContentLimit(Number(value)))
              }
            }}
          />
        </SettingRow>
      </SettingGroup>
    </>
  )
}
export default BasicSettings
