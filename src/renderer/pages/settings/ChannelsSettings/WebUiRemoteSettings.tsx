import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Tooltip
} from '@cherrystudio/ui'
import {
  SettingDivider,
  SettingGroup,
  SettingRow,
  SettingRowTitle,
  SettingsContentColumn,
  SettingTitle
} from '@renderer/components/SettingsPrimitives'
import { useSharedCache } from '@renderer/data/hooks/useCache'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { useTheme } from '@renderer/hooks/useTheme'
import { toast } from '@renderer/services/toast'
import { Dices, Eye, EyeOff, Server } from 'lucide-react'
import type { ChangeEvent, FC, KeyboardEvent } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

const MIN_PORT = 1024
const MAX_PORT = 65535
const HOST_LOOPBACK = '127.0.0.1'
const HOST_LAN = '0.0.0.0'
const HOST_CUSTOM = '__custom__'

const IPV4_PATTERN = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/

const isValidPort = (port: number) => Number.isInteger(port) && port >= MIN_PORT && port <= MAX_PORT

const isValidHost = (host: string) => host === HOST_LOOPBACK || host === HOST_LAN || IPV4_PATTERN.test(host.trim())

const generateAccessKey = () => {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

const WebUiRemoteSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const [enabled, setEnabled] = usePreference('feature.webui.enabled')
  const [authKey, setAuthKey] = usePreference('feature.webui.auth_key')
  const [host, setHost] = usePreference('feature.webui.host')
  const [port, setPort] = usePreference('feature.webui.port')
  const [running] = useSharedCache('feature.webui.running', false)
  const [authKeyDraft, setAuthKeyDraft] = useState(authKey)
  const [portDraft, setPortDraft] = useState(String(port))
  const [showAuthKey, setShowAuthKey] = useState(false)
  const [hostMode, setHostMode] = useState<string>(() =>
    host === HOST_LOOPBACK || host === HOST_LAN ? host : HOST_CUSTOM
  )
  const [customHostDraft, setCustomHostDraft] = useState(() =>
    host === HOST_LOOPBACK || host === HOST_LAN ? '' : host
  )

  useEffect(() => {
    setAuthKeyDraft(authKey)
  }, [authKey])

  useEffect(() => {
    setPortDraft(String(port))
  }, [port])

  useEffect(() => {
    if (host === HOST_LOOPBACK || host === HOST_LAN) {
      setHostMode(host)
    } else {
      setHostMode(HOST_CUSTOM)
      setCustomHostDraft(host)
    }
  }, [host])

  // Legacy installs may have enabled=true without a key; force off until a key exists.
  useEffect(() => {
    if (enabled && !authKey.trim()) {
      void setEnabled(false)
    }
  }, [authKey, enabled, setEnabled])

  const effectiveAuthKey = useMemo(() => authKeyDraft.trim() || authKey.trim(), [authKey, authKeyDraft])

  const saveAuthKey = () => {
    const nextKey = authKeyDraft.trim()
    if (!nextKey && enabled) {
      toast.warning(t('settings.webui.access_key_required'))
      setAuthKeyDraft(authKey)
      return
    }
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

  const handleEnabledChange = (checked: boolean) => {
    if (checked) {
      const key = effectiveAuthKey
      if (!key) {
        toast.warning(t('settings.webui.access_key_required'))
        return
      }
      if (authKeyDraft.trim() && authKeyDraft.trim() !== authKey) {
        void setAuthKey(authKeyDraft.trim())
      }
    }
    void setEnabled(checked)
  }

  const handleHostModeChange = (value: string) => {
    setHostMode(value)
    if (value === HOST_LOOPBACK || value === HOST_LAN) {
      if (value !== host) void setHost(value)
    }
  }

  const saveCustomHost = () => {
    const next = customHostDraft.trim()
    if (!isValidHost(next) || next === HOST_LOOPBACK || next === HOST_LAN) {
      if (host !== HOST_LOOPBACK && host !== HOST_LAN) {
        setCustomHostDraft(host)
      } else {
        setCustomHostDraft('')
      }
      toast.warning(t('settings.webui.host_invalid'))
      return
    }
    if (next !== host) void setHost(next)
  }

  const handleGenerateKey = () => {
    const nextKey = generateAccessKey()
    setAuthKeyDraft(nextKey)
    setShowAuthKey(true)
    void setAuthKey(nextKey)
    toast.success(t('settings.webui.access_key_generated'))
  }

  return (
    <SettingsContentColumn theme={theme}>
      <SettingGroup theme={theme}>
        <div className="min-w-0 pb-1">
          <SettingTitle className="justify-start gap-2">
            <Server className="size-5 shrink-0" />
            <span className="truncate">{t('settings.webui.title')}</span>
          </SettingTitle>
          <p className="mt-1.5 mb-0 text-foreground-muted text-xs">{t('settings.webui.description')}</p>
        </div>
        <SettingDivider className="m-0 mt-2" />
        <SettingRow>
          <SettingRowTitle>{t('settings.webui.enable_lan_access')}</SettingRowTitle>
          <Switch checked={enabled} onCheckedChange={handleEnabledChange} />
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
          <SettingRowTitle>{t('settings.webui.listen_host')}</SettingRowTitle>
          <div className="flex max-w-[280px] flex-1 flex-col items-end gap-2">
            <Select value={hostMode} onValueChange={handleHostModeChange}>
              <SelectTrigger className="w-[220px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={HOST_LOOPBACK}>{t('settings.webui.host_loopback')}</SelectItem>
                <SelectItem value={HOST_LAN}>{t('settings.webui.host_lan')}</SelectItem>
                <SelectItem value={HOST_CUSTOM}>{t('settings.webui.host_custom')}</SelectItem>
              </SelectContent>
            </Select>
            {hostMode === HOST_CUSTOM && (
              <Input
                onBlur={saveCustomHost}
                onChange={(event) => setCustomHostDraft(event.target.value)}
                onKeyDown={handlePortKeyDown}
                placeholder={t('settings.webui.host_custom_placeholder')}
                value={customHostDraft}
                style={{ width: 220 }}
              />
            )}
          </div>
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.webui.access_key')}</SettingRowTitle>
          <div className="flex items-center gap-1">
            <Input
              onBlur={saveAuthKey}
              onChange={(event) => setAuthKeyDraft(event.target.value)}
              onKeyDown={handlePortKeyDown}
              placeholder={t('settings.webui.access_key_placeholder')}
              type={showAuthKey ? 'text' : 'password'}
              value={authKeyDraft}
              style={{ width: 180 }}
            />
            <Tooltip title={showAuthKey ? t('settings.webui.hide_access_key') : t('settings.webui.show_access_key')}>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={showAuthKey ? t('settings.webui.hide_access_key') : t('settings.webui.show_access_key')}
                onClick={() => setShowAuthKey((prev) => !prev)}>
                {showAuthKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </Button>
            </Tooltip>
            <Tooltip title={t('settings.webui.generate_access_key')}>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t('settings.webui.generate_access_key')}
                onClick={handleGenerateKey}>
                <Dices className="size-4" />
              </Button>
            </Tooltip>
          </div>
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
