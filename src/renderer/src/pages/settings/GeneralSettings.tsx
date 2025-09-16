import { InfoCircleOutlined } from '@ant-design/icons'
import { useMultiplePreferences, usePreference } from '@data/hooks/usePreference'
import { HStack } from '@renderer/components/Layout'
import Selector from '@renderer/components/Selector'
import { InfoTooltip } from '@renderer/components/TooltipIcons'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useTimer } from '@renderer/hooks/useTimer'
import i18n from '@renderer/i18n'
import type { NotificationSource } from '@renderer/types/notification'
import { isValidProxyUrl } from '@renderer/utils'
import { formatErrorMessage } from '@renderer/utils/error'
import { defaultByPassRules, defaultLanguage } from '@shared/config/constant'
import type { LanguageVarious } from '@shared/data/preference/preferenceTypes'
import { Flex, Input, Switch, Tooltip } from 'antd'
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
    { value: 'pl', label: 'Polski', flag: '🇵🇱' }
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
                <Flex align="center" gap={8}>
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
              <SettingRowTitle>{t('settings.proxy.bypass')}</SettingRowTitle>
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
          <HStack justifyContent="space-between" alignItems="center" style={{ flex: 1, marginRight: 16 }}>
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
                    <Flex align="center" gap={8}>
                      <span role="img" aria-label={lang.flag}>
                        {lang.flag}
                      </span>
                      {lang.label}
                    </Flex>
                  )
                }))}
              />
            )}
          </HStack>
          <Switch checked={enableSpellCheck} onChange={handleSpellCheckChange} />
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.hardware_acceleration.title')}</SettingRowTitle>
          <Switch checked={disableHardwareAcceleration} onChange={handleHardwareAccelerationChange} />
        </SettingRow>
      </SettingGroup>
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.notification.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span>{t('settings.notification.assistant')}</span>
            <Tooltip title={t('notification.tip')} placement="right">
              <InfoCircleOutlined style={{ cursor: 'pointer' }} />
            </Tooltip>
          </SettingRowTitle>
          <Switch checked={notificationSettings.assistant} onChange={(v) => handleNotificationChange('assistant', v)} />
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.notification.backup')}</SettingRowTitle>
          <Switch checked={notificationSettings.backup} onChange={(v) => handleNotificationChange('backup', v)} />
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.notification.knowledge_embed')}</SettingRowTitle>
          <Switch checked={notificationSettings.knowledge} onChange={(v) => handleNotificationChange('knowledge', v)} />
        </SettingRow>
      </SettingGroup>
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.launch.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.launch.onboot')}</SettingRowTitle>
          <Switch checked={launchOnBoot} onChange={(checked) => updateLaunchOnBoot(checked)} />
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.launch.totray')}</SettingRowTitle>
          <Switch checked={launchToTray} onChange={(checked) => updateLaunchToTray(checked)} />
        </SettingRow>
      </SettingGroup>
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.tray.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.tray.show')}</SettingRowTitle>
          <Switch checked={tray} onChange={(checked) => updateTray(checked)} />
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.tray.onclose')}</SettingRowTitle>
          <Switch checked={trayOnClose} onChange={(checked) => updateTrayOnClose(checked)} />
        </SettingRow>
      </SettingGroup>
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.privacy.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.privacy.enable_privacy_mode')}</SettingRowTitle>
          <Switch
            value={enableDataCollection}
            onChange={(v) => {
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
          <Flex align="center" gap={4}>
            <SettingRowTitle>{t('settings.developer.enable_developer_mode')}</SettingRowTitle>
            <InfoTooltip title={t('settings.developer.help')} />
          </Flex>
          <Switch checked={enableDeveloperMode} onChange={setEnableDeveloperMode} />
        </SettingRow>
      </SettingGroup>
    </SettingContainer>
  )
}

export default GeneralSettings
