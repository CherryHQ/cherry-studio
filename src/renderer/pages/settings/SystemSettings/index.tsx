import { Flex, InfoTooltip, Input, Switch } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import Selector from '@renderer/components/Selector'
import { defaultByPassRules } from '@renderer/config/constant'
import { useTheme } from '@renderer/hooks/useTheme'
import { useTimer } from '@renderer/hooks/useTimer'
import { formatErrorMessage } from '@renderer/utils/error'
import { isValidProxyUrl } from '@renderer/utils/url'
import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingsContentColumn, SettingTitle } from '..'

const SystemSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const { setTimeoutTimer } = useTimer()

  const [disableHardwareAcceleration, setDisableHardwareAcceleration] = usePreference(
    'BootConfig.app.disable_hardware_acceleration'
  )
  const [launchOnBoot, setLaunchOnBoot] = usePreference('app.launch_on_boot')
  const [launchToTray, setLaunchToTray] = usePreference('app.tray.on_launch')
  const [trayOnClose, setTrayOnClose] = usePreference('app.tray.on_close')
  const [tray, setTray] = usePreference('app.tray.enabled')
  const [preventSleepWhenBusy, setPreventSleepWhenBusy] = usePreference('app.power.prevent_sleep_when_busy')
  const [storeProxyMode, setProxyMode] = usePreference('app.proxy.mode')
  const [storeProxyBypassRules, _setProxyBypassRules] = usePreference('app.proxy.bypass_rules')
  const [storeProxyUrl, _setProxyUrl] = usePreference('app.proxy.url')
  const [enableDeveloperMode, setEnableDeveloperMode] = usePreference('app.developer_mode.enabled')

  const [proxyUrl, setProxyUrl] = useState<string>(storeProxyUrl)
  const [proxyBypassRules, setProxyBypassRules] = useState<string>(storeProxyBypassRules)

  const proxyModeOptions: { value: 'system' | 'custom' | 'none'; label: string }[] = [
    { value: 'system', label: t('settings.proxy.mode.system') },
    { value: 'custom', label: t('settings.proxy.mode.custom') },
    { value: 'none', label: t('settings.proxy.mode.none') }
  ]

  const updateTray = (isShowTray: boolean) => {
    void setTray(isShowTray)
    if (!isShowTray) {
      updateTrayOnClose(false)
      updateLaunchToTray(false)
    }
  }

  const updateTrayOnClose = (isTrayOnClose: boolean) => {
    void setTrayOnClose(isTrayOnClose)
    if (isTrayOnClose && !tray) {
      updateTray(true)
    }
  }

  const updateLaunchToTray = (isLaunchToTray: boolean) => {
    void setLaunchToTray(isLaunchToTray)
    if (isLaunchToTray && !tray) {
      updateTray(true)
    }
  }

  const onSetProxyUrl = () => {
    if (proxyUrl && !isValidProxyUrl(proxyUrl)) {
      window.toast.error(t('message.error.invalid.proxy.url'))
      return
    }

    void _setProxyUrl(proxyUrl)
  }

  const onSetProxyBypassRules = () => {
    void _setProxyBypassRules(proxyBypassRules)
  }

  const handleHardwareAccelerationChange = (checked: boolean) => {
    void window.modal.confirm({
      title: t('settings.hardware_acceleration.confirm.title'),
      content: t('settings.hardware_acceleration.confirm.content'),
      okText: t('common.confirm'),
      cancelText: t('common.cancel'),
      centered: true,
      async onOk() {
        try {
          await setDisableHardwareAcceleration(checked)
        } catch (error) {
          window.toast.error(formatErrorMessage(error))
          throw error
        }

        setTimeoutTimer(
          'handleHardwareAccelerationChange',
          () => {
            void window.api.application.relaunch()
          },
          500
        )
      }
    })
  }

  return (
    <SettingsContentColumn theme={theme}>
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.launch.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.launch.onboot')}</SettingRowTitle>
          <Switch checked={launchOnBoot} onCheckedChange={(checked) => void setLaunchOnBoot(checked)} />
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.launch.totray')}</SettingRowTitle>
          <Switch checked={launchToTray} onCheckedChange={(checked) => updateLaunchToTray(checked)} />
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.tray.show')}</SettingRowTitle>
          <Switch checked={tray} onCheckedChange={(checked) => updateTray(checked)} />
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.tray.onclose')}</SettingRowTitle>
          <Switch checked={trayOnClose} onCheckedChange={(checked) => updateTrayOnClose(checked)} />
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.power.prevent_sleep_when_busy')}</SettingRowTitle>
          <Switch checked={preventSleepWhenBusy} onCheckedChange={(checked) => void setPreventSleepWhenBusy(checked)} />
        </SettingRow>
      </SettingGroup>

      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.proxy.mode.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.proxy.mode.title')}</SettingRowTitle>
          <Selector value={storeProxyMode} onChange={(mode) => void setProxyMode(mode)} options={proxyModeOptions} />
        </SettingRow>
        {storeProxyMode === 'custom' && (
          <>
            <SettingDivider />
            <SettingRow>
              <SettingRowTitle>{t('settings.proxy.address')}</SettingRowTitle>
              <Input
                spellCheck={false}
                placeholder="socks5://127.0.0.1:6153"
                value={proxyUrl}
                onChange={(e) => setProxyUrl(e.target.value)}
                style={{ width: 220 }}
                onBlur={onSetProxyUrl}
                type="url"
              />
            </SettingRow>
            <SettingDivider />
            <SettingRow>
              <SettingRowTitle style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span>{t('settings.proxy.bypass')}</span>
                <InfoTooltip
                  content={t('settings.proxy.tip')}
                  placement="right"
                  iconProps={{ className: 'cursor-pointer' }}
                />
              </SettingRowTitle>
              <Input
                spellCheck={false}
                placeholder={defaultByPassRules}
                value={proxyBypassRules}
                onChange={(e) => setProxyBypassRules(e.target.value)}
                style={{ width: 220 }}
                onBlur={onSetProxyBypassRules}
              />
            </SettingRow>
          </>
        )}
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.hardware_acceleration.title')}</SettingRowTitle>
          <Switch checked={disableHardwareAcceleration} onCheckedChange={handleHardwareAccelerationChange} />
        </SettingRow>
      </SettingGroup>

      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.developer.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow>
          <Flex className="items-center gap-1">
            <SettingRowTitle>{t('settings.developer.enable_developer_mode')}</SettingRowTitle>
            <InfoTooltip content={t('settings.developer.help')} />
          </Flex>
          <Switch checked={enableDeveloperMode} onCheckedChange={setEnableDeveloperMode} />
        </SettingRow>
      </SettingGroup>
    </SettingsContentColumn>
  )
}

export default SystemSettings
