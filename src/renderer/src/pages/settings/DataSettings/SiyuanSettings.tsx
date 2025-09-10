import { InfoCircleOutlined } from '@ant-design/icons'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { RowFlex } from '@renderer/components/Layout'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useMinappPopup } from '@renderer/hooks/useMinappPopup'
import { Button, Space, Tooltip } from 'antd'
import { Input } from 'antd'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '..'

const logger = loggerService.withContext('SiyuanSettings')

const SiyuanSettings: FC = () => {
  const [siyuanApiUrl, setSiyuanApiUrl] = usePreference('data.integration.siyuan.api_url')
  const [siyuanToken, setSiyuanToken] = usePreference('data.integration.siyuan.token')
  const [siyuanBoxId, setSiyuanBoxId] = usePreference('data.integration.siyuan.box_id')
  const [siyuanRootPath, setSiyuanRootPath] = usePreference('data.integration.siyuan.root_path')

  const { openMinapp } = useMinappPopup()
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

  const handleSiyuanHelpClick = () => {
    openMinapp({
      id: 'siyuan-help',
      name: 'Siyuan Help',
      url: 'https://docs.cherry-ai.com/advanced-basic/siyuan'
    })
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
        <RowFlex align="center" gap="5px" style={{ width: 315 }}>
          <Input
            type="text"
            value={siyuanApiUrl || ''}
            onChange={handleApiUrlChange}
            style={{ width: 315 }}
            placeholder={t('settings.data.siyuan.api_url_placeholder')}
          />
        </RowFlex>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle style={{ display: 'flex', alignItems: 'center' }}>
          <span>{t('settings.data.siyuan.token.label')}</span>
          <Tooltip title={t('settings.data.siyuan.token.help')} placement="left">
            <InfoCircleOutlined
              style={{ color: 'var(--color-text-2)', cursor: 'pointer', marginLeft: 4 }}
              onClick={handleSiyuanHelpClick}
            />
          </Tooltip>
        </SettingRowTitle>
        <RowFlex align="center" gap="5px" style={{ width: 315 }}>
          <Space.Compact style={{ width: '100%' }}>
            <Input.Password
              value={siyuanToken || ''}
              onChange={handleTokenChange}
              onBlur={handleTokenChange}
              placeholder={t('settings.data.siyuan.token_placeholder')}
              style={{ width: '100%' }}
            />
            <Button onClick={handleCheckConnection}>{t('settings.data.siyuan.check.button')}</Button>
          </Space.Compact>
        </RowFlex>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.siyuan.box_id')}</SettingRowTitle>
        <RowFlex align="center" gap="5px" style={{ width: 315 }}>
          <Input
            type="text"
            value={siyuanBoxId || ''}
            onChange={handleBoxIdChange}
            style={{ width: 315 }}
            placeholder={t('settings.data.siyuan.box_id_placeholder')}
          />
        </RowFlex>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.siyuan.root_path')}</SettingRowTitle>
        <RowFlex align="center" gap="5px" style={{ width: 315 }}>
          <Input
            type="text"
            value={siyuanRootPath || ''}
            onChange={handleRootPathChange}
            style={{ width: 315 }}
            placeholder={t('settings.data.siyuan.root_path_placeholder')}
          />
        </RowFlex>
      </SettingRow>
    </SettingGroup>
  )
}

export default SiyuanSettings
