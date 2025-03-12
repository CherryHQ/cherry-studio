import { InfoCircleOutlined } from '@ant-design/icons'
import { HStack } from '@renderer/components/Layout'
import MinApp from '@renderer/components/MinApp'
import { useTheme } from '@renderer/context/ThemeProvider'
import { RootState, useAppDispatch } from '@renderer/store'
import { setYuqueRepoId, setYuqueToken, setYuqueUrl } from '@renderer/store/settings'
import { Button, Tooltip } from 'antd'
import Input from 'antd/es/input/Input'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'

import { SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '..'

const YuqueSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const dispatch = useAppDispatch()

  const yuqueToken = useSelector((state: RootState) => state.settings.yuqueToken)
  const yuqueUrl = useSelector((state: RootState) => state.settings.yuqueUrl)

  const handleYuqueTokenChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    dispatch(setYuqueToken(e.target.value))
  }

  const handleYuqueRepoUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    dispatch(setYuqueUrl(e.target.value))
  }

  const handleYuqueConnectionCheck = async () => {
    if (!yuqueToken) {
      window.message.error(t('settings.data.yuque.check.empty_token'))
      return
    }
    if (!yuqueUrl) {
      window.message.error(t('settings.data.yuque.check.empty_url'))
      return
    }

    const response = await fetch('https://www.yuque.com/api/v2/hello', {
      headers: {
        'X-Auth-Token': yuqueToken
      }
    })

    if (!response.ok) {
      window.message.error(t('settings.data.yuque.check.fail'))
      return
    }
    const yuqueSlug = yuqueUrl.replace('https://www.yuque.com/', '')
    const repoIDResponse = await fetch(`https://www.yuque.com/api/v2/repos/${yuqueSlug}`, {
      headers: {
        'X-Auth-Token': yuqueToken
      }
    })
    if (!repoIDResponse.ok) {
      window.message.error(t('settings.data.yuque.check.fail'))
      return
    }
    const data = await repoIDResponse.json()
    dispatch(setYuqueRepoId(data.data.id))
    window.message.success(t('settings.data.yuque.check.success'))
  }

  const handleYuqueHelpClick = () => {
    MinApp.start({
      id: 'yuque-help',
      name: 'Yuque Help',
      url: 'https://www.yuque.com/settings/tokens'
    })
  }

  return (
    <SettingGroup theme={theme}>
      <SettingTitle>{t('settings.data.yuque.title')}</SettingTitle>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.yuque.repo_url')}</SettingRowTitle>
        <HStack alignItems="center" gap="5px" style={{ width: 315 }}>
          <Input
            type="text"
            value={yuqueUrl || ''}
            onChange={handleYuqueRepoUrlChange}
            style={{ width: 315 }}
            placeholder={t('settings.data.yuque.repo_url_placeholder')}
          />
        </HStack>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>
          {t('settings.data.yuque.token')}
          <Tooltip title={t('settings.data.yuque.help')} placement="left">
            <InfoCircleOutlined
              style={{ color: 'var(--color-text-2)', cursor: 'pointer', marginLeft: 4 }}
              onClick={handleYuqueHelpClick}
            />
          </Tooltip>
        </SettingRowTitle>
        <HStack alignItems="center" gap="5px" style={{ width: 315 }}>
          <Input
            type="password"
            value={yuqueToken || ''}
            onChange={handleYuqueTokenChange}
            style={{ width: 250 }}
            placeholder={t('settings.data.yuque.token_placeholder')}
          />
          <Button onClick={handleYuqueConnectionCheck}>{t('settings.data.yuque.check.button')}</Button>
        </HStack>
      </SettingRow>
    </SettingGroup>
  )
}

export default YuqueSettings
