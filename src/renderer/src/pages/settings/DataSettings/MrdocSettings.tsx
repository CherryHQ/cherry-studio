import { InfoCircleOutlined } from '@ant-design/icons'
import { HStack } from '@renderer/components/Layout'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useMinappPopup } from '@renderer/hooks/useMinappPopup'
import { RootState, useAppDispatch } from '@renderer/store'
import { setMrdocApiUrl, setMrdocBoxId, setMrdocToken } from '@renderer/store/settings'
import { Button, Tooltip } from 'antd'
import Input from 'antd/es/input/Input'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'

import { SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '..'

const MrdocSettings: FC = () => {
  const { openMinapp } = useMinappPopup()
  const { t } = useTranslation()
  const { theme } = useTheme()
  const dispatch = useAppDispatch()

  const mrdocApiUrl = useSelector((state: RootState) => state.settings.mrdocApiUrl)
  const mrdocToken = useSelector((state: RootState) => state.settings.mrdocToken)
  const mrdocBoxId = useSelector((state: RootState) => state.settings.mrdocBoxId)

  const handleApiUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    dispatch(setMrdocApiUrl(e.target.value))
  }

  const handleTokenChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    dispatch(setMrdocToken(e.target.value))
  }

  const handleBoxIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    dispatch(setMrdocBoxId(e.target.value))
  }

  const handleMrdocHelpClick = () => {
    openMinapp({
      id: 'mrdoc-help',
      name: 'Mrdoc Help',
      url: 'https://docs.cherry-ai.com/advanced-basic/mrdoc'
    })
  }

  const handleCheckConnection = async () => {
    try {
      if (!mrdocApiUrl || !mrdocToken) {
        window.message.error(t('settings.data.mrdoc.check.empty_config'))
        return
      }

      const response = await fetch(`${mrdocApiUrl}/api/check_token/?token=${mrdocToken}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      })

      if (!response.ok) {
        window.message.error(t('settings.data.mrdoc.check.fail'))
        return
      }

      const data = await response.json()
      console.log(data)
      if (!data.status) {
        window.message.error(t('settings.data.mrdoc.check.fail'))
        return
      }

      window.message.success(t('settings.data.mrdoc.check.success'))
    } catch (error) {
      console.error('Check Mrdoc connection failed:', error)
      window.message.error(t('settings.data.mrdoc.check.error'))
    }
  }

  return (
    <SettingGroup theme={theme}>
      <SettingTitle>{t('settings.data.mrdoc.title')}</SettingTitle>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.mrdoc.api_url')}</SettingRowTitle>
        <HStack alignItems="center" gap="5px" style={{ width: 315 }}>
          <Input
            type="text"
            value={mrdocApiUrl || ''}
            onChange={handleApiUrlChange}
            style={{ width: 315 }}
            placeholder={t('settings.data.mrdoc.api_url_placeholder')}
          />
        </HStack>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle style={{ display: 'flex', alignItems: 'center' }}>
          <span>{t('settings.data.mrdoc.token')}</span>
          <Tooltip title={t('settings.data.mrdoc.token.help')} placement="left">
            <InfoCircleOutlined
              style={{ color: 'var(--color-text-2)', cursor: 'pointer', marginLeft: 4 }}
              onClick={handleMrdocHelpClick}
            />
          </Tooltip>
        </SettingRowTitle>
        <HStack alignItems="center" gap="5px" style={{ width: 315 }}>
          <Input
            type="password"
            value={mrdocToken || ''}
            onChange={handleTokenChange}
            style={{ width: 250 }}
            placeholder={t('settings.data.mrdoc.token_placeholder')}
          />
          <Button onClick={handleCheckConnection}>{t('settings.data.mrdoc.check.button')}</Button>
        </HStack>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.mrdoc.box_id')}</SettingRowTitle>
        <HStack alignItems="center" gap="5px" style={{ width: 315 }}>
          <Input
            type="text"
            value={mrdocBoxId || ''}
            onChange={handleBoxIdChange}
            style={{ width: 315 }}
            placeholder={t('settings.data.mrdoc.box_id_placeholder')}
          />
        </HStack>
      </SettingRow>
    </SettingGroup>
  )
}

export default MrdocSettings
