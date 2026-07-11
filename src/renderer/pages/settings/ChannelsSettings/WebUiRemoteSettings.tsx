import { Input, Switch } from '@cherrystudio/ui'
import { useSharedCache } from '@renderer/data/hooks/useCache'
import { usePreference } from '@renderer/data/hooks/usePreference'
import {
  SettingDivider,
  SettingGroup,
  SettingRow,
  SettingRowTitle,
  SettingsContentColumn,
  SettingTitle
} from '@renderer/components/SettingsPrimitives'
import { useTheme } from '@renderer/hooks/useTheme'
import type { ChangeEvent, FC, KeyboardEvent } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const MIN_PORT = 1024
const MAX_PORT = 65535

const isValidPort = (port: number) => Number.isInteger(port) && port >= MIN_PORT && port <= MAX_PORT

const WebUiRemoteSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const [enabled, setEnabled] = usePreference('feature.webui.enabled')
  const [authKey, setAuthKey] = usePreference('feature.webui.auth_key')
  const [port, setPort] = usePreference('feature.webui.port')
  const [running] = useSharedCache('feature.webui.running', false)
  const [authKeyDraft, setAuthKeyDraft] = useState(authKey)
  const [portDraft, setPortDraft] = useState(String(port))

  useEffect(() => {
    setAuthKeyDraft(authKey)
  }, [authKey])

  useEffect(() => {
    setPortDraft(String(port))
  }, [port])

  const saveAuthKey = () => {
    const nextKey = authKeyDraft.trim()
    if (nextKey !== authKey) void setAuthKey(nextKey)
  }

  const savePort = () => {
    const nextPort = Number(portDraft)
    if (!isValidPort(nextPort)) {
      setPortDraft(String(port))
      return
    }
    if (nextPort !== port) void setPort(nextPort)
  }

  const handlePortChange = (event: ChangeEvent<HTMLInputElement>) => {
    setPortDraft(event.target.value.replace(/\D/g, ''))
  }

  const handlePortKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') event.currentTarget.blur()
  }

  return (
    <SettingsContentColumn theme={theme}>
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.webui.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.webui.enable_remote_access')}</SettingRowTitle>
          <Switch checked={enabled} onCheckedChange={(checked) => void setEnabled(checked)} />
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.webui.service_status')}</SettingRowTitle>
          <span className={running ? 'text-success text-sm' : 'text-foreground-muted text-sm'}>
            {running ? t('settings.webui.running') : t('settings.webui.stopped')}
          </span>
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.webui.access_key')}</SettingRowTitle>
          <Input
            onBlur={saveAuthKey}
            onChange={(event) => setAuthKeyDraft(event.target.value)}
            onKeyDown={handlePortKeyDown}
            placeholder={t('settings.webui.access_key_placeholder')}
            type="password"
            value={authKeyDraft}
            style={{ width: 220 }}
          />
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.webui.port')}</SettingRowTitle>
          <Input
            inputMode="numeric"
            max={MAX_PORT}
            min={MIN_PORT}
            onBlur={savePort}
            onChange={handlePortChange}
            onKeyDown={handlePortKeyDown}
            type="text"
            value={portDraft}
            style={{ width: 120 }}
          />
        </SettingRow>
      </SettingGroup>
    </SettingsContentColumn>
  )
}

export default WebUiRemoteSettings
