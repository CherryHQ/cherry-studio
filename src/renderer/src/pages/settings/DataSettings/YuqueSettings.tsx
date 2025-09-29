import { Button, InfoTooltip, RowFlex } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { useTheme } from '@renderer/context/ThemeProvider'
import { Space } from 'antd'
import { Input } from 'antd'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '..'

const YuqueSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()

  const [yuqueToken, setYuqueToken] = usePreference('data.integration.yuque.token')
  const [yuqueUrl, setYuqueUrl] = usePreference('data.integration.yuque.url')
  const [, setYuqueRepoId] = usePreference('data.integration.yuque.repo_id')

  const handleYuqueTokenChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setYuqueToken(e.target.value)
  }

  const handleYuqueRepoUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setYuqueUrl(e.target.value)
  }

  const handleYuqueConnectionCheck = async () => {
    if (!yuqueToken) {
      window.toast.error(t('settings.data.yuque.check.empty_token'))
      return
    }
    if (!yuqueUrl) {
      window.toast.error(t('settings.data.yuque.check.empty_repo_url'))
      return
    }

    const response = await fetch('https://www.yuque.com/api/v2/hello', {
      headers: {
        'X-Auth-Token': yuqueToken
      }
    })

    if (!response.ok) {
      window.toast.error(t('settings.data.yuque.check.fail'))
      return
    }
    const yuqueSlug = yuqueUrl.replace('https://www.yuque.com/', '')
    const repoIDResponse = await fetch(`https://www.yuque.com/api/v2/repos/${yuqueSlug}`, {
      headers: {
        'X-Auth-Token': yuqueToken
      }
    })
    if (!repoIDResponse.ok) {
      window.toast.error(t('settings.data.yuque.check.fail'))
      return
    }
    const data = await repoIDResponse.json()
    setYuqueRepoId(data.data.id)
    window.toast.success(t('settings.data.yuque.check.success'))
  }

  return (
    <SettingGroup theme={theme}>
      <SettingTitle>{t('settings.data.yuque.title')}</SettingTitle>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.yuque.repo_url')}</SettingRowTitle>
        <RowFlex className="w-[315px] items-center gap-[5px]">
          <Input
            type="text"
            value={yuqueUrl || ''}
            onChange={handleYuqueRepoUrlChange}
            placeholder={t('settings.data.yuque.repo_url_placeholder')}
          />
        </RowFlex>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>
          {t('settings.data.yuque.token')}
          <InfoTooltip
            title={t('settings.data.yuque.help')}
            placement="left"
            iconStyle={{ color: 'var(--color-text-2)', cursor: 'pointer', marginLeft: 4 }}
          />
        </SettingRowTitle>
        <RowFlex className="w-[315px] items-center gap-[5px]">
          <Space.Compact style={{ width: '100%' }}>
            <Input.Password
              value={yuqueToken || ''}
              onChange={handleYuqueTokenChange}
              onBlur={handleYuqueTokenChange}
              placeholder={t('settings.data.yuque.token_placeholder')}
              style={{ width: '100%' }}
            />
            <Button onPress={handleYuqueConnectionCheck}>{t('settings.data.yuque.check.button')}</Button>
          </Space.Compact>
        </RowFlex>
      </SettingRow>
    </SettingGroup>
  )
}

export default YuqueSettings
