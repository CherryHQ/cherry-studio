import { InfoCircleOutlined } from '@ant-design/icons'
import { HStack } from '@renderer/components/Layout'
import { useTheme } from '@renderer/context/ThemeProvider'
import { IntegrationType, useThirdPartyIntegration } from '@renderer/hooks/useThirdPartyIntegration'
import { RootState } from '@renderer/store'
import { setYuqueRepoId, setYuqueToken, setYuqueUrl } from '@renderer/store/settings'
import { Button, Space, Tooltip } from 'antd'
import { Input } from 'antd'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'

import { SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '..'

const YuqueSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()

  const yuqueToken = useSelector((state: RootState) => state.settings.yuqueToken)
  const yuqueUrl = useSelector((state: RootState) => state.settings.yuqueUrl)
  const yuqueRepoId = useSelector((state: RootState) => state.settings.yuqueRepoId)

  const yuqueConfig = {
    type: 'yuque' as IntegrationType,
    helpUrl: 'https://www.yuque.com/settings/tokens',
    fieldSetters: {
      yuqueToken: setYuqueToken,
      yuqueUrl: setYuqueUrl,
      yuqueRepoId: setYuqueRepoId
    },
    connectionCheckConfig: {
      requiredFields: ['yuqueToken', 'yuqueUrl'],
      checkFunction: async (values, t) => {
        try {
          const response = await fetch('https://www.yuque.com/api/v2/hello', {
            headers: {
              'X-Auth-Token': values.yuqueToken
            }
          })

          if (!response.ok) {
            window.message.error(t('settings.data.yuque.check.fail'))
            return
          }

          const yuqueSlug = values.yuqueUrl.replace('https://www.yuque.com/', '')
          const repoIDResponse = await fetch(`https://www.yuque.com/api/v2/repos/${yuqueSlug}`, {
            headers: {
              'X-Auth-Token': values.yuqueToken
            }
          })

          if (!repoIDResponse.ok) {
            window.message.error(t('settings.data.yuque.check.fail'))
            return
          }

          const data = await repoIDResponse.json()
          if (data.data && data.data.id) {
            setYuqueRepoId(data.data.id)
            window.message.success(t('settings.data.yuque.check.success'))
          } else {
            window.message.error(t('settings.data.yuque.check.fail'))
          }
        } catch (e) {
          window.message.error(t('settings.data.yuque.check.fail'))
        }
      }
    }
  }

  const fieldValues = {
    yuqueToken,
    yuqueUrl,
    yuqueRepoId
  }

  const { handleInputChange, handleInputBlur, handleConnectionCheck, handleHelpClick } = useThirdPartyIntegration(
    yuqueConfig,
    fieldValues
  )

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
            onChange={handleInputChange('yuqueUrl')}
            onBlur={handleInputBlur('yuqueUrl')}
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
              onClick={handleHelpClick}
            />
          </Tooltip>
        </SettingRowTitle>
        <HStack alignItems="center" gap="5px" style={{ width: 315 }}>
          <Space.Compact style={{ width: '100%' }}>
            <Input.Password
              value={yuqueToken || ''}
              onChange={handleInputChange('yuqueToken')}
              onBlur={handleInputBlur('yuqueToken')}
              placeholder={t('settings.data.yuque.token_placeholder')}
              style={{ width: '100%' }}
            />
            <Button onClick={handleConnectionCheck}>{t('settings.data.yuque.check.button')}</Button>
          </Space.Compact>
        </HStack>
      </SettingRow>
    </SettingGroup>
  )
}

export default YuqueSettings
