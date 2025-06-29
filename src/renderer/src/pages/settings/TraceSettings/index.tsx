import { TRACE_PROVIDER_CONFIG } from '@renderer/config/traceProviders'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useTrace } from '@renderer/hooks/useTrace'
import { TraceProviderType } from '@renderer/types/trace'
import { Select, Switch } from 'antd'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingContainer, SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '..'
import LangfuseSettings from './LangfuseSettings'

const TraceSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const { enabled: isTraceEnabled, provider, setEnabled: setTraceEnabled, setProvider } = useTrace()

  return (
    <SettingContainer theme={theme}>
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.trace.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.trace.enabled')}</SettingRowTitle>
          <Switch checked={isTraceEnabled} onChange={(checked) => setTraceEnabled(checked)} />
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.trace.provider')}</SettingRowTitle>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Select
              value={provider}
              style={{ width: '200px' }}
              onChange={(value: string) => setProvider(value as TraceProviderType)}
              options={Object.keys(TRACE_PROVIDER_CONFIG).map((p) => ({
                value: p,
                label: p
              }))}
            />
          </div>
        </SettingRow>
      </SettingGroup>
      <SettingGroup theme={theme}>{provider === 'langfuse' && <LangfuseSettings />}</SettingGroup>
    </SettingContainer>
  )
}
export default TraceSettings
