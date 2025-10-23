import { InfoTooltip, RowFlex } from '@cherrystudio/ui'
import { Flex } from '@cherrystudio/ui'
import { Switch } from '@cherrystudio/ui'
import { useMultiplePreferences, usePreference } from '@data/hooks/usePreference'
import Selector from '@renderer/components/Selector'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useTimer } from '@renderer/hooks/useTimer'
import i18n from '@renderer/i18n'
import type { NotificationSource } from '@renderer/types/notification'
import { isValidProxyUrl } from '@renderer/utils'
import { formatErrorMessage } from '@renderer/utils/error'
import { defaultByPassRules, defaultLanguage } from '@shared/config/constant'
import type { LanguageVarious } from '@shared/data/preference/preferenceTypes'
import { Input } from 'antd'
import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingContainer, SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '.'

const GeneralSettings: FC = () => {
  const [language, setLanguage] = usePreference('app.language')
  const [disableHardwareAcceleration, setDisableHardwareAcceleration] = usePreference(
    'app.disable_hardware_acceleration'
  )
  const [enableDeveloperMode, setEnableDeveloperMode] = usePreference('app.developer_mode.enabled')
  const [launchOnBoot, setLaunchOnBoot] = usePreference('app.launch_on_boot')
  const [launchToTray, setLaunchToTray] = usePreference('app.tray.on_launch')
  const [trayOnClose, setTrayOnClose] = usePreference('app.tray.on_close')
  const [tray, setTray] = usePreference('app.tray.enabled')
  const [enableDataCollection, setEnableDataCollection] = usePreference('app.privacy.data_collection.enabled')
  const [storeProxyMode, setProxyMode] = usePreference('app.proxy.mode')
  const [storeProxyBypassRules, _setProxyBypassRules] = usePreference('app.proxy.bypass_rules')
  const [storeProxyUrl, _setProxyUrl] = usePreference('app.proxy.url')
  const [enableSpellCheck, setEnableSpellCheck] = usePreference('app.spell_check.enabled')
  const [spellCheckLanguages, setSpellCheckLanguages] = usePreference('app.spell_check.languages')
  const [notificationSettings, setNotificationSettings] = useMultiplePreferences({
    assistant: 'app.notification.assistant.enabled',
    backup: 'app.notification.backup.enabled',
    knowledge: 'app.notification.knowledge.enabled'
  })

  const [proxyUrl, setProxyUrl] = useState<string>(storeProxyUrl)
  const [proxyBypassRules, setProxyBypassRules] = useState<string>(storeProxyBypassRules)
  const { theme } = useTheme()
  const { setTimeoutTimer } = useTimer()

  const updateTray = (isShowTray: boolean) => {
    setTray(isShowTray)
    //only set tray on close/launch to tray when tray is enabled
    if (!isShowTray) {
      updateTrayOnClose(false)
      updateLaunchToTray(false)
    }
  }

  const updateTrayOnClose = (isTrayOnClose: boolean) => {
    setTrayOnClose(isTrayOnClose)
    //in case tray is not enabled, enable it
    if (isTrayOnClose && !tray) {
      updateTray(true)
    }
  }

  const updateLaunchOnBoot = (isLaunchOnBoot: boolean) => {
    setLaunchOnBoot(isLaunchOnBoot)
  }

  const updateLaunchToTray = (isLaunchToTray: boolean) => {
    setLaunchToTray(isLaunchToTray)
    if (isLaunchToTray && !tray) {
      updateTray(true)
    }
  }

  // const dispatch = useAppDispatch()
  const { t } = useTranslation()

  const onSelectLanguage = (value: LanguageVarious) => {
    // dispatch(setLanguage(value))
    // localStorage.setItem('language', value)
    // window.api.setLanguage(value)
    i18n.changeLanguage(value)
    setLanguage(value)
  }

  const handleSpellCheckChange = (checked: boolean) => {
    setEnableSpellCheck(checked)
    window.api.setEnableSpellCheck(checked)
  }

  const onSetProxyUrl = () => {
    if (proxyUrl && !isValidProxyUrl(proxyUrl)) {
      window.toast.error(t('message.error.invalid.proxy.url'))
      return
    }

    _setProxyUrl(proxyUrl)
  }

  const onSetProxyBypassRules = () => {
    _setProxyBypassRules(proxyBypassRules)
  }

  const proxyModeOptions: { value: 'system' | 'custom' | 'none'; label: string }[] = [
    { value: 'system', label: t('settings.proxy.mode.system') },
    { value: 'custom', label: t('settings.proxy.mode.custom') },
    { value: 'none', label: t('settings.proxy.mode.none') }
  ]

  const onProxyModeChange = (mode: 'system' | 'custom' | 'none') => {
    setProxyMode(mode)
  }

  const languagesOptions: { value: LanguageVarious; label: string; flag: string }[] = [
    { value: 'zh-CN', label: '中文', flag: '🇨🇳' },
    { value: 'zh-TW', label: '中文（繁体）', flag: '🇭🇰' },
    { value: 'en-US', label: 'English', flag: '🇺🇸' },
    { value: 'de-DE', label: 'Deutsch', flag: '🇩🇪' },
    { value: 'ja-JP', label: '日本語', flag: '🇯🇵' },
    { value: 'ru-RU', label: 'Русский', flag: '🇷🇺' },
    { value: 'el-GR', label: 'Ελληνικά', flag: '🇬🇷' },
    { value: 'es-ES', label: 'Español', flag: '🇪🇸' },
    { value: 'fr-FR', label: 'Français', flag: '🇫🇷' },
    { value: 'pt-PT', label: 'Português', flag: '🇵🇹' }
  ]

  const handleNotificationChange = (type: NotificationSource, value: boolean) => {
    setNotificationSettings({ [type]: value })
  }

  // Define available spell check languages with display names (only commonly supported languages)
  const spellCheckLanguageOptions = [
    { value: 'en-US', label: 'English (US)', flag: '🇺🇸' },
    { value: 'es', label: 'Español', flag: '🇪🇸' },
    { value: 'fr', label: 'Français', flag: '🇫🇷' },
    { value: 'de', label: 'Deutsch', flag: '🇩🇪' },
    { value: 'it', label: 'Italiano', flag: '🇮🇹' },
    { value: 'pt', label: 'Português', flag: '🇵🇹' },
    { value: 'ru', label: 'Русский', flag: '🇷🇺' },
    { value: 'nl', label: 'Nederlands', flag: '🇳🇱' },
    { value: 'pl', label: 'Polski', flag: '🇵🇱' },
    { value: 'el', label: 'Ελληνικά', flag: '🇬🇷' }
  ]

  const handleSpellCheckLanguagesChange = (selectedLanguages: string[]) => {
    setSpellCheckLanguages(selectedLanguages)
  }

  const handleHardwareAccelerationChange = (checked: boolean) => {
    window.modal.confirm({
      title: t('settings.hardware_acceleration.confirm.title'),
      content: t('settings.hardware_acceleration.confirm.content'),
      okText: t('common.confirm'),
      cancelText: t('common.cancel'),
      centered: true,
      onOk() {
        try {
          setDisableHardwareAcceleration(checked)
        } catch (error) {
          window.toast.error(formatErrorMessage(error))
          return
        }

        // 重启应用
        setTimeoutTimer(
          'handleHardwareAccelerationChange',
          () => {
            window.api.relaunchApp()
          },
          500
        )
      }
    })
  }

  return (
    <SettingContainer theme={theme}>
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.general.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('common.language')}</SettingRowTitle>
          <Selector
            size={14}
            value={language || defaultLanguage}
            onChange={onSelectLanguage}
            options={languagesOptions.map((lang) => ({
              label: (
                <Flex className="items-center gap-2">
                  <span role="img" aria-label={lang.flag}>
                    {lang.flag}
                  </span>
                  {lang.label}
                </Flex>
              ),
              value: lang.value
            }))}
          />
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.proxy.mode.title')}</SettingRowTitle>
          <Selector value={storeProxyMode} onChange={onProxyModeChange} options={proxyModeOptions} />
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
                style={{ width: 180 }}
                onBlur={() => onSetProxyUrl()}
                type="url"
              />
            </SettingRow>
          </>
        )}
        {storeProxyMode === 'custom' && (
          <>
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
                style={{ width: 180 }}
                onBlur={() => onSetProxyBypassRules()}
              />
            </SettingRow>
          </>
        )}
        <SettingDivider />
        <SettingRow>
          <RowFlex className="mr-4 flex-1 items-center justify-between">
            <SettingRowTitle>{t('settings.general.spell_check.label')}</SettingRowTitle>
            {enableSpellCheck && (
              <Selector<string>
                size={14}
                multiple
                value={spellCheckLanguages}
                placeholder={t('settings.general.spell_check.languages')}
                onChange={handleSpellCheckLanguagesChange}
                options={spellCheckLanguageOptions.map((lang) => ({
                  value: lang.value,
                  label: (
                    <Flex className="items-center gap-2">
                      <span role="img" aria-label={lang.flag}>
                        {lang.flag}
                      </span>
                      {lang.label}
                    </Flex>
                  )
                }))}
              />
            )}
          </RowFlex>
          <Switch isSelected={enableSpellCheck} onValueChange={handleSpellCheckChange} />
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.hardware_acceleration.title')}</SettingRowTitle>
          <Switch isSelected={disableHardwareAcceleration} onValueChange={handleHardwareAccelerationChange} />
        </SettingRow>
      </SettingGroup>
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.notification.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span>{t('settings.notification.assistant')}</span>
            <InfoTooltip
              content={t('notification.tip')}
              placement="right"
              iconProps={{ className: 'cursor-pointer' }}
            />
          </SettingRowTitle>
          <Switch
            isSelected={notificationSettings.assistant}
            onValueChange={(v) => handleNotificationChange('assistant', v)}
          />
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.notification.backup')}</SettingRowTitle>
          <Switch
            isSelected={notificationSettings.backup}
            onValueChange={(v) => handleNotificationChange('backup', v)}
          />
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.notification.knowledge_embed')}</SettingRowTitle>
          <Switch
            isSelected={notificationSettings.knowledge}
            onValueChange={(v) => handleNotificationChange('knowledge', v)}
          />
        </SettingRow>
      </SettingGroup>
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.launch.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.launch.onboot')}</SettingRowTitle>
          <Switch isSelected={launchOnBoot} onValueChange={(checked) => updateLaunchOnBoot(checked)} />
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.launch.totray')}</SettingRowTitle>
          <Switch isSelected={launchToTray} onValueChange={(checked) => updateLaunchToTray(checked)} />
        </SettingRow>
      </SettingGroup>
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.tray.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.tray.show')}</SettingRowTitle>
          <Switch isSelected={tray} onValueChange={(checked) => updateTray(checked)} />
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.tray.onclose')}</SettingRowTitle>
          <Switch isSelected={trayOnClose} onValueChange={(checked) => updateTrayOnClose(checked)} />
        </SettingRow>
      </SettingGroup>
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.privacy.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.privacy.enable_privacy_mode')}</SettingRowTitle>
          <Switch
            isSelected={enableDataCollection}
            onValueChange={(v) => {
              setEnableDataCollection(v)
              window.api.config.set('enableDataCollection', v)
            }}
          />
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
          <Switch isSelected={enableDeveloperMode} onValueChange={setEnableDeveloperMode} />
        </SettingRow>
      </SettingGroup>
    </SettingContainer>
  )
}

export default GeneralSettings
