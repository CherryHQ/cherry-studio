import { Flex, InfoTooltip, Input, Switch } from '@cherrystudio/ui'
import { useMultiplePreferences, usePreference } from '@data/hooks/usePreference'
import CopyButton from '@renderer/components/CopyButton'
import Selector from '@renderer/components/Selector'
import {
  SettingDivider,
  SettingGroup,
  SettingRow,
  SettingRowTitle,
  SettingsContentColumn,
  SettingTitle
} from '@renderer/components/SettingsPrimitives'
import { useTheme } from '@renderer/hooks/useTheme'
import { useTimer } from '@renderer/hooks/useTimer'
import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import { formatErrorMessage } from '@renderer/utils/error'
import { isValidProxyUrl } from '@renderer/utils/url'
import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ContextManagementSettings } from './ContextManagementSettings'

const defaultByPassRules = 'localhost,127.0.0.1,::1'

const TRAY_PREFERENCE_KEYS = {
  enabled: 'app.tray.enabled',
  onClose: 'app.tray.on_close',
  onLaunch: 'app.tray.on_launch',
  clickTrayToShowQuickAssistant: 'feature.quick_assistant.click_tray_to_show'
} as const

const GeneralSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const { setTimeoutTimer } = useTimer()

  const [disableHardwareAcceleration, setDisableHardwareAcceleration] = usePreference(
    'BootConfig.app.disable_hardware_acceleration'
  )
  const [launchOnBoot, setLaunchOnBoot] = usePreference('app.launch_on_boot')
  const [trayPreferences, setTrayPreferences] = useMultiplePreferences(TRAY_PREFERENCE_KEYS)
  const { enabled: tray, onClose: trayOnClose, onLaunch: launchToTray } = trayPreferences
  const [preventSleepWhenBusy, setPreventSleepWhenBusy] = usePreference('app.power.prevent_sleep_when_busy')
  const [allowPrivateNetworkFetch, setAllowPrivateNetworkFetch] = usePreference('app.fetch.allow_private_network')
  const [storeProxyMode, setProxyMode] = usePreference('app.proxy.mode')
  const [storeProxyBypassRules, _setProxyBypassRules] = usePreference('app.proxy.bypass_rules')
  const [storeProxyUrl, _setProxyUrl] = usePreference('app.proxy.url')
  const [enableDeveloperMode, setEnableDeveloperMode] = usePreference('app.developer_mode.enabled')
  const [clientId] = usePreference('app.user.id')

  const [proxyUrl, setProxyUrl] = useState<string>(storeProxyUrl)
  const [proxyBypassRules, setProxyBypassRules] = useState<string>(storeProxyBypassRules)

  const proxyModeOptions: { value: 'system' | 'custom' | 'none'; label: string }[] = [
    { value: 'system', label: t('settings.proxy.mode.system') },
    { value: 'custom', label: t('settings.proxy.mode.custom') },
    { value: 'none', label: t('settings.proxy.mode.none') }
  ]

  const updateTray = (isShowTray: boolean) => {
    void setTrayPreferences(
      isShowTray
        ? { enabled: true }
        : { enabled: false, onClose: false, onLaunch: false, clickTrayToShowQuickAssistant: false }
    )
  }

  const updateTrayOnClose = (isTrayOnClose: boolean) => {
    void setTrayPreferences(isTrayOnClose && !tray ? { enabled: true, onClose: true } : { onClose: isTrayOnClose })
  }

  const updateLaunchToTray = (isLaunchToTray: boolean) => {
    void setTrayPreferences(isLaunchToTray && !tray ? { enabled: true, onLaunch: true } : { onLaunch: isLaunchToTray })
  }

  const onSetProxyUrl = () => {
    if (proxyUrl && !isValidProxyUrl(proxyUrl)) {
      toast.error(t('message.error.invalid.proxy.url'))
      return
    }

    void _setProxyUrl(proxyUrl)
  }

  const onSetProxyBypassRules = () => {
    void _setProxyBypassRules(proxyBypassRules)
  }

  const handleHardwareAccelerationChange = async (checked: boolean) => {
    const confirmed = await popup.confirm({
      title: t('settings.hardware_acceleration.confirm.title'),
      content: checked
        ? t('settings.hardware_acceleration.confirm.content_disable')
        : t('settings.hardware_acceleration.confirm.content_enable'),
      okText: t('common.confirm'),
      cancelText: t('common.cancel'),
      centered: true
    })
    if (!confirmed) return

    try {
      await setDisableHardwareAcceleration(checked)
    } catch (error) {
      toast.error(formatErrorMessage(error))
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

  return (
    <SettingsContentColumn theme={theme}>
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.launch.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow id="setting-general-launch-onboot" className="scroll-mt-6">
          <SettingRowTitle>{t('settings.launch.onboot')}</SettingRowTitle>
          <Switch checked={launchOnBoot} onCheckedChange={(checked) => void setLaunchOnBoot(checked)} />
        </SettingRow>
        <SettingDivider />
        <SettingRow id="setting-general-launch-totray" className="scroll-mt-6">
          <SettingRowTitle>{t('settings.launch.totray')}</SettingRowTitle>
          <Switch checked={launchToTray} onCheckedChange={(checked) => updateLaunchToTray(checked)} />
        </SettingRow>
        <SettingDivider />
        <SettingRow id="setting-general-tray-show" className="scroll-mt-6">
          <SettingRowTitle>{t('settings.tray.show')}</SettingRowTitle>
          <Switch checked={tray} onCheckedChange={(checked) => updateTray(checked)} />
        </SettingRow>
        <SettingDivider />
        <SettingRow id="setting-general-tray-onclose" className="scroll-mt-6">
          <SettingRowTitle>{t('settings.tray.onclose')}</SettingRowTitle>
          <Switch checked={trayOnClose} onCheckedChange={(checked) => updateTrayOnClose(checked)} />
        </SettingRow>
        <SettingDivider />
        <SettingRow id="setting-general-prevent-sleep-when-busy" className="scroll-mt-6">
          <SettingRowTitle>{t('settings.power.prevent_sleep_when_busy')}</SettingRowTitle>
          <Switch checked={preventSleepWhenBusy} onCheckedChange={(checked) => void setPreventSleepWhenBusy(checked)} />
        </SettingRow>
      </SettingGroup>

      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.proxy.mode.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow id="setting-general-proxy-mode" className="scroll-mt-6">
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
        <SettingRow id="setting-general-allow-private-network" className="scroll-mt-6">
          <SettingRowTitle style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span>{t('settings.fetch.allow_private_network')}</span>
            <InfoTooltip
              content={t('settings.fetch.allow_private_network_tip')}
              placement="right"
              iconProps={{ className: 'cursor-pointer' }}
            />
          </SettingRowTitle>
          <Switch
            checked={allowPrivateNetworkFetch}
            onCheckedChange={(checked) => void setAllowPrivateNetworkFetch(checked)}
          />
        </SettingRow>
        <SettingDivider />
        <SettingRow id="setting-general-hardware-acceleration" className="scroll-mt-6">
          <SettingRowTitle>{t('settings.hardware_acceleration.title')}</SettingRowTitle>
          <Switch checked={disableHardwareAcceleration} onCheckedChange={handleHardwareAccelerationChange} />
        </SettingRow>
      </SettingGroup>

      <ContextManagementSettings />

      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.developer.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow id="setting-general-enable-developer-mode" className="scroll-mt-6">
          <Flex className="items-center gap-1">
            <SettingRowTitle>{t('settings.developer.enable_developer_mode')}</SettingRowTitle>
            <InfoTooltip content={t('settings.developer.help')} />
          </Flex>
          <Switch checked={enableDeveloperMode} onCheckedChange={setEnableDeveloperMode} />
        </SettingRow>
        {enableDeveloperMode && clientId ? (
          <>
            <SettingDivider />
            <SettingRow className="gap-3">
              <SettingRowTitle>{t('settings.developer.client_id')}</SettingRowTitle>
              <div className="flex min-w-0 items-center gap-2">
                <span className="select-text break-all text-right font-mono text-foreground-tertiary text-xs">
                  {clientId}
                </span>
                <CopyButton textToCopy={clientId} successFeedback="icon" />
              </div>
            </SettingRow>
          </>
        ) : null}
      </SettingGroup>
    </SettingsContentColumn>
  )
}

export default GeneralSettings
