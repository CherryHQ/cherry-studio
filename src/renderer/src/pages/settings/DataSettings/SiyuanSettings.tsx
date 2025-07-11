import { InfoCircleOutlined } from '@ant-design/icons'
import { HStack } from '@renderer/components/Layout'
import { useTheme } from '@renderer/context/ThemeProvider'
import { IntegrationType, useThirdPartyIntegration } from '@renderer/hooks/useThirdPartyIntegration'
import { RootState } from '@renderer/store'
import { setSiyuanApiUrl, setSiyuanBoxId, setSiyuanRootPath, setSiyuanToken } from '@renderer/store/settings'
import { Button, Space, Tooltip } from 'antd'
import { Input } from 'antd'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'

import { SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '..'

const SiyuanSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()

  const siyuanApiUrl = useSelector((state: RootState) => state.settings.siyuanApiUrl)
  const siyuanToken = useSelector((state: RootState) => state.settings.siyuanToken)
  const siyuanBoxId = useSelector((state: RootState) => state.settings.siyuanBoxId)
  const siyuanRootPath = useSelector((state: RootState) => state.settings.siyuanRootPath)

  const siyuanConfig = {
    type: 'siyuan' as IntegrationType,
    helpUrl: 'https://docs.cherry-ai.com/advanced-basic/siyuan',
    fieldSetters: {
      siyuanApiUrl: setSiyuanApiUrl,
      siyuanToken: setSiyuanToken,
      siyuanBoxId: setSiyuanBoxId,
      siyuanRootPath: setSiyuanRootPath
    },
    connectionCheckConfig: {
      requiredFields: ['siyuanApiUrl', 'siyuanToken'],
      checkFunction: async (values, t) => {
        try {
          const response = await fetch(`${values.siyuanApiUrl}/api/notebook/lsNotebooks`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Token ${values.siyuanToken}`
            }
          })

          if (!response.ok) {
            window.message.error(t('settings.data.siyuan.check.fail'))
            return
          }

          const data = await response.json()
          if (data.code !== 0) {
            window.message.error(t('settings.data.siyuan.check.fail'))
            return
          }

          window.message.success(t('settings.data.siyuan.check.success'))
        } catch (error) {
          console.error('Check Siyuan connection failed:', error)
          window.message.error(t('settings.data.siyuan.check.error'))
        }
      }
    }
  }

  const fieldValues = {
    siyuanApiUrl,
    siyuanToken,
    siyuanBoxId,
    siyuanRootPath
  }

  const { handleInputChange, handleInputBlur, handleConnectionCheck, handleHelpClick } = useThirdPartyIntegration(
    siyuanConfig,
    fieldValues
  )

  return (
    <SettingGroup theme={theme}>
      <SettingTitle>{t('settings.data.siyuan.title')}</SettingTitle>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.siyuan.api_url')}</SettingRowTitle>
        <HStack alignItems="center" gap="5px" style={{ width: 315 }}>
          <Input
            type="text"
            value={siyuanApiUrl || ''}
            onChange={handleInputChange('siyuanApiUrl')}
            onBlur={handleInputBlur('siyuanApiUrl')}
            style={{ width: 315 }}
            placeholder={t('settings.data.siyuan.api_url_placeholder')}
          />
        </HStack>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle style={{ display: 'flex', alignItems: 'center' }}>
          <span>{t('settings.data.siyuan.token')}</span>
          <Tooltip title={t('settings.data.siyuan.token.help')} placement="left">
            <InfoCircleOutlined
              style={{ color: 'var(--color-text-2)', cursor: 'pointer', marginLeft: 4 }}
              onClick={handleHelpClick}
            />
          </Tooltip>
        </SettingRowTitle>
        <HStack alignItems="center" gap="5px" style={{ width: 315 }}>
          <Space.Compact style={{ width: '100%' }}>
            <Input.Password
              value={siyuanToken || ''}
              onChange={handleInputChange('siyuanToken')}
              onBlur={handleInputBlur('siyuanToken')}
              placeholder={t('settings.data.siyuan.token_placeholder')}
              style={{ width: '100%' }}
            />
            <Button onClick={handleConnectionCheck}>{t('settings.data.siyuan.check.button')}</Button>
          </Space.Compact>
        </HStack>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.siyuan.box_id')}</SettingRowTitle>
        <HStack alignItems="center" gap="5px" style={{ width: 315 }}>
          <Input
            type="text"
            value={siyuanBoxId || ''}
            onChange={handleInputChange('siyuanBoxId')}
            onBlur={handleInputBlur('siyuanBoxId')}
            style={{ width: 315 }}
            placeholder={t('settings.data.siyuan.box_id_placeholder')}
          />
        </HStack>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.siyuan.root_path')}</SettingRowTitle>
        <HStack alignItems="center" gap="5px" style={{ width: 315 }}>
          <Input
            type="text"
            value={siyuanRootPath || ''}
            onChange={handleInputChange('siyuanRootPath')}
            onBlur={handleInputBlur('siyuanRootPath')}
            style={{ width: 315 }}
            placeholder={t('settings.data.siyuan.root_path_placeholder')}
          />
        </HStack>
      </SettingRow>
    </SettingGroup>
  )
}

export default SiyuanSettings
