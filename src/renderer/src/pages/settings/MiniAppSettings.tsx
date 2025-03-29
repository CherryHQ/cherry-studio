import { DEFAULT_MIN_APPS } from '@renderer/config/minapps'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useMinapps } from '@renderer/hooks/useMinapps'
import { Button } from 'antd'
import { FC, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingContainer, SettingDivider, SettingGroup, SettingTitle } from '.'
import MiniAppIconsManager from './DisplaySettings/MiniAppIconsManager'

const MiniAppSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const { minapps, disabled, updateMinapps, updateDisabledMinapps } = useMinapps()

  const [visibleMiniApps, setVisibleMiniApps] = useState(minapps)
  const [disabledMiniApps, setDisabledMiniApps] = useState(disabled || [])

  const handleResetMinApps = useCallback(() => {
    setVisibleMiniApps(DEFAULT_MIN_APPS)
    setDisabledMiniApps([])
    updateMinapps(DEFAULT_MIN_APPS)
    updateDisabledMinapps([])
  }, [updateDisabledMinapps, updateMinapps])

  return (
    <SettingContainer theme={theme}>
      <SettingGroup theme={theme}>
        <SettingTitle
          style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{t('settings.miniapps.title')}</span>
          <ResetButtonWrapper>
            <Button onClick={handleResetMinApps}>{t('common.reset')}</Button>
          </ResetButtonWrapper>
        </SettingTitle>
        <SettingDivider />
        <MiniAppIconsManager
          visibleMiniApps={visibleMiniApps}
          disabledMiniApps={disabledMiniApps}
          setVisibleMiniApps={setVisibleMiniApps}
          setDisabledMiniApps={setDisabledMiniApps}
        />
      </SettingGroup>
    </SettingContainer>
  )
}

const ResetButtonWrapper = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
`

export default MiniAppSettings
