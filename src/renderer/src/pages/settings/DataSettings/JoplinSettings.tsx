import { InfoCircleOutlined } from '@ant-design/icons'
import { HStack } from '@renderer/components/Layout'
import MinApp from '@renderer/components/MinApp'
import { useTheme } from '@renderer/context/ThemeProvider'
import { RootState, useAppDispatch } from '@renderer/store'
import { setJoplinToken, setJoplinUrl } from '@renderer/store/settings'
import { Button, Tooltip } from 'antd'
import Input from 'antd/es/input/Input'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'

import { SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '..'

const JoplinSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const dispatch = useAppDispatch()

  const joplinToken = useSelector((state: RootState) => state.settings.joplinToken)
  const joplinUrl = useSelector((state: RootState) => state.settings.joplinUrl)

  const handleJoplinTokenChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    dispatch(setJoplinToken(e.target.value))
  }

  const handleJoplinUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    dispatch(setJoplinUrl(e.target.value))
  }

  const handleJoplinUrlBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    let url = e.target.value
    // 确保URL以/结尾，但只在失去焦点时执行
    if (url && !url.endsWith('/')) {
      url = `${url}/`
      dispatch(setJoplinUrl(url))
    }
  }

  const handleJoplinConnectionCheck = async () => {
    try {
      if (!joplinToken) {
        window.message.error(t('settings.data.joplin.check.empty_token'))
        return
      }
      if (!joplinUrl) {
        window.message.error(t('settings.data.joplin.check.empty_url'))
        return
      }

      const response = await fetch(`${joplinUrl}notes?limit=1&token=${joplinToken}`)

      const data = await response.json()

      if (!response.ok || data?.error) {
        window.message.error(t('settings.data.joplin.check.fail'))
        return
      }

      window.message.success(t('settings.data.joplin.check.success'))
    } catch (e) {
      window.message.error(t('settings.data.joplin.check.fail'))
    }
  }

  const handleJoplinHelpClick = () => {
    MinApp.start({
      id: 'joplin-help',
      name: 'Joplin Help',
      url: 'https://joplinapp.org/help/apps/clipper'
    })
  }

  return (
    <SettingGroup theme={theme}>
      <SettingTitle>{t('settings.data.joplin.title')}</SettingTitle>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.joplin.url')}</SettingRowTitle>
        <HStack alignItems="center" gap="5px" style={{ width: 315 }}>
          <Input
            type="text"
            value={joplinUrl || ''}
            onChange={handleJoplinUrlChange}
            onBlur={handleJoplinUrlBlur}
            style={{ width: 315 }}
            placeholder={t('settings.data.joplin.url_placeholder')}
          />
        </HStack>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle style={{ display: 'flex', alignItems: 'center' }}>
          <span>{t('settings.data.joplin.token')}</span>
          <Tooltip title={t('settings.data.joplin.help')} placement="left">
            <InfoCircleOutlined
              style={{ color: 'var(--color-text-2)', cursor: 'pointer', marginLeft: 4 }}
              onClick={handleJoplinHelpClick}
            />
          </Tooltip>
        </SettingRowTitle>
        <HStack alignItems="center" gap="5px" style={{ width: 315 }}>
          <Input
            type="password"
            value={joplinToken || ''}
            onChange={handleJoplinTokenChange}
            style={{ width: 250 }}
            placeholder={t('settings.data.joplin.token_placeholder')}
          />
          <Button onClick={handleJoplinConnectionCheck}>{t('settings.data.joplin.check.button')}</Button>
        </HStack>
      </SettingRow>
    </SettingGroup>
  )
}

export default JoplinSettings
