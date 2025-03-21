import { InfoCircleOutlined } from '@ant-design/icons'
import { HStack } from '@renderer/components/Layout'
import MinApp from '@renderer/components/MinApp'
import { useTheme } from '@renderer/context/ThemeProvider'
import { RootState, useAppDispatch } from '@renderer/store'
import { setObsidianApiKey, setObsidianUrl } from '@renderer/store/settings'
import { Button, Tooltip } from 'antd'
import Input from 'antd/es/input/Input'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'

import { SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '..'

const ObsidianSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const dispatch = useAppDispatch()

  const obsidianApiKey = useSelector((state: RootState) => state.settings.obsidianApiKey)
  const obsidianUrl = useSelector((state: RootState) => state.settings.obsidianUrl)

  const handleObsidianApiKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    dispatch(setObsidianApiKey(e.target.value))
  }

  const handleObsidianUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    dispatch(setObsidianUrl(e.target.value))
  }

  const handleObsidianUrlBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    let url = e.target.value
    // 确保URL以/结尾，但只在失去焦点时执行
    if (url && !url.endsWith('/')) {
      url = `${url}/`
      dispatch(setObsidianUrl(url))
    }
  }

  const handleObsidianConnectionCheck = async () => {
    try {
      if (!obsidianApiKey) {
        window.message.error(t('settings.data.obsidian.check.empty_api_key'))
        return
      }
      if (!obsidianUrl) {
        window.message.error(t('settings.data.obsidian.check.empty_url'))
        return
      }

      const response = await fetch(`${obsidianUrl}`, {
        headers: {
          Authorization: `Bearer ${obsidianApiKey}`
        }
      })

      const data = await response.json()

      if (!response.ok || !data?.authenticated) {
        window.message.error(t('settings.data.obsidian.check.fail'))
        return
      }

      window.message.success(t('settings.data.obsidian.check.success'))
    } catch (e) {
      window.message.error(t('settings.data.obsidian.check.fail'))
    }
  }

  const handleObsidianHelpClick = () => {
    MinApp.start({
      id: 'obsidian-help',
      name: 'Obsidian Help',
      url: 'https://github.com/coddingtonbear/obsidian-local-rest-api'
    })
  }

  return (
    <SettingGroup theme={theme}>
      <SettingTitle>{t('settings.data.obsidian.title')}</SettingTitle>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.obsidian.url')}</SettingRowTitle>
        <HStack alignItems="center" gap="5px" style={{ width: 315 }}>
          <Input
            type="text"
            value={obsidianUrl || ''}
            onChange={handleObsidianUrlChange}
            onBlur={handleObsidianUrlBlur}
            style={{ width: 315 }}
            placeholder={t('settings.data.obsidian.url_placeholder')}
          />
        </HStack>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle style={{ display: 'flex', alignItems: 'center' }}>
          <span>{t('settings.data.obsidian.api_key')}</span>
          <Tooltip title={t('settings.data.obsidian.help')} placement="left">
            <InfoCircleOutlined
              style={{ color: 'var(--color-text-2)', cursor: 'pointer', marginLeft: 4 }}
              onClick={handleObsidianHelpClick}
            />
          </Tooltip>
        </SettingRowTitle>
        <HStack alignItems="center" gap="5px" style={{ width: 315 }}>
          <Input
            type="password"
            value={obsidianApiKey || ''}
            onChange={handleObsidianApiKeyChange}
            style={{ width: 250 }}
            placeholder={t('settings.data.obsidian.api_key_placeholder')}
          />
          <Button onClick={handleObsidianConnectionCheck}>{t('settings.data.obsidian.check.button')}</Button>
        </HStack>
      </SettingRow>
    </SettingGroup>
  )
}

export default ObsidianSettings
