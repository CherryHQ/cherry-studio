import { InfoCircleOutlined } from '@ant-design/icons'
import { HStack } from '@renderer/components/Layout'
import { useTheme } from '@renderer/context/ThemeProvider'
import { IntegrationType, useThirdPartyIntegration } from '@renderer/hooks/useThirdPartyIntegration'
import { RootState } from '@renderer/store'
import { setJoplinExportReasoning, setJoplinToken, setJoplinUrl } from '@renderer/store/settings'
import { Button, Space, Switch, Tooltip } from 'antd'
import { Input } from 'antd'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'

import { SettingDivider, SettingGroup, SettingHelpText, SettingRow, SettingRowTitle, SettingTitle } from '..'

const JoplinSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()

  const joplinToken = useSelector((state: RootState) => state.settings.joplinToken)
  const joplinUrl = useSelector((state: RootState) => state.settings.joplinUrl)
  const joplinExportReasoning = useSelector((state: RootState) => state.settings.joplinExportReasoning)

  const joplinConfig = {
    type: 'joplin' as IntegrationType,
    helpUrl: 'https://joplinapp.org/help/apps/clipper',
    fieldSetters: {
      joplinToken: setJoplinToken,
      joplinUrl: setJoplinUrl,
      joplinExportReasoning: setJoplinExportReasoning
    },
    connectionCheckConfig: {
      requiredFields: ['joplinToken', 'joplinUrl'],
      checkFunction: async (values, t) => {
        try {
          const response = await fetch(`${values.joplinUrl}notes?limit=1&token=${values.joplinToken}`)
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
    }
  }

  const fieldValues = {
    joplinToken,
    joplinUrl,
    joplinExportReasoning
  }

  const { handleInputChange, handleInputBlur, handleSwitchChange, handleConnectionCheck, handleHelpClick } =
    useThirdPartyIntegration(joplinConfig, fieldValues)

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
            onChange={handleInputChange('joplinUrl')}
            onBlur={handleInputBlur('joplinUrl', (value) => (value && !value.endsWith('/') ? `${value}/` : value))}
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
              onClick={handleHelpClick}
            />
          </Tooltip>
        </SettingRowTitle>
        <HStack alignItems="center" gap="5px" style={{ width: 315 }}>
          <Space.Compact style={{ width: '100%' }}>
            <Input.Password
              value={joplinToken || ''}
              onChange={handleInputChange('joplinToken')}
              onBlur={handleInputBlur('joplinToken')}
              placeholder={t('settings.data.joplin.token_placeholder')}
              style={{ width: '100%' }}
            />
            <Button onClick={handleConnectionCheck}>{t('settings.data.joplin.check.button')}</Button>
          </Space.Compact>
        </HStack>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.joplin.export_reasoning.title')}</SettingRowTitle>
        <Switch checked={joplinExportReasoning} onChange={handleSwitchChange('joplinExportReasoning')} />
      </SettingRow>
      <SettingRow>
        <SettingHelpText>{t('settings.data.joplin.export_reasoning.help')}</SettingHelpText>
      </SettingRow>
    </SettingGroup>
  )
}

export default JoplinSettings
