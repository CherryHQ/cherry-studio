import { Button, InfoTooltip, RowFlex } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { useTheme } from '@renderer/context/ThemeProvider'
import { Space } from 'antd'
import { Input } from 'antd'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '..'

const logger = loggerService.withContext('SiyuanSettings')

const SiyuanSettings: FC = () => {
  const [siyuanApiUrl, setSiyuanApiUrl] = usePreference('data.integration.siyuan.api_url')
  const [siyuanToken, setSiyuanToken] = usePreference('data.integration.siyuan.token')
  const [siyuanBoxId, setSiyuanBoxId] = usePreference('data.integration.siyuan.box_id')
  const [siyuanRootPath, setSiyuanRootPath] = usePreference('data.integration.siyuan.root_path')

  const { t } = useTranslation()
  const { theme } = useTheme()

  const handleApiUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSiyuanApiUrl(e.target.value)
  }

  const handleTokenChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSiyuanToken(e.target.value)
  }

  const handleBoxIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSiyuanBoxId(e.target.value)
  }

  const handleRootPathChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSiyuanRootPath(e.target.value)
  }

  const handleCheckConnection = async () => {
    try {
      if (!siyuanApiUrl || !siyuanToken) {
        window.toast.error(t('settings.data.siyuan.check.empty_config'))
        return
      }

      const response = await fetch(`${siyuanApiUrl}/api/notebook/lsNotebooks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Token ${siyuanToken}`
        }
      })

      if (!response.ok) {
        window.toast.error(t('settings.data.siyuan.check.fail'))
        return
      }

      const data = await response.json()
      if (data.code !== 0) {
        window.toast.error(t('settings.data.siyuan.check.fail'))
        return
      }

      window.toast.success(t('settings.data.siyuan.check.success'))
    } catch (error) {
      logger.error('Check Siyuan connection failed:', error as Error)
      window.toast.error(t('settings.data.siyuan.check.error'))
    }
  }

  return (
    <SettingGroup theme={theme}>
      <SettingTitle>{t('settings.data.siyuan.title')}</SettingTitle>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.siyuan.api_url')}</SettingRowTitle>
        <RowFlex className="w-[315px] items-center gap-[5px]">
          <Input
            type="text"
            value={siyuanApiUrl || ''}
            onChange={handleApiUrlChange}
            placeholder={t('settings.data.siyuan.api_url_placeholder')}
          />
        </RowFlex>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle style={{ display: 'flex', alignItems: 'center' }}>
          <span>{t('settings.data.siyuan.token.label')}</span>
          <InfoTooltip
            title={t('settings.data.siyuan.token.help')}
            placement="left"
            iconStyle={{ color: 'var(--color-text-2)', cursor: 'pointer', marginLeft: 4 }}
          />
        </SettingRowTitle>
        <RowFlex className="w-[315px] items-center gap-[5px]">
          <Space.Compact style={{ width: '100%' }}>
            <Input.Password
              value={siyuanToken || ''}
              onChange={handleTokenChange}
              onBlur={handleTokenChange}
              placeholder={t('settings.data.siyuan.token_placeholder')}
              style={{ width: '100%' }}
            />
            <Button onPress={handleCheckConnection}>{t('settings.data.siyuan.check.button')}</Button>
          </Space.Compact>
        </RowFlex>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.siyuan.box_id')}</SettingRowTitle>
        <RowFlex className="w-[315px] items-center gap-[5px]">
          <Input
            type="text"
            value={siyuanBoxId || ''}
            onChange={handleBoxIdChange}
            placeholder={t('settings.data.siyuan.box_id_placeholder')}
          />
        </RowFlex>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.siyuan.root_path')}</SettingRowTitle>
        <RowFlex className="w-[315px] items-center gap-[5px]">
          <Input
            type="text"
            value={siyuanRootPath || ''}
            onChange={handleRootPathChange}
            placeholder={t('settings.data.siyuan.root_path_placeholder')}
          />
        </RowFlex>
      </SettingRow>
    </SettingGroup>
  )
}

export default SiyuanSettings
