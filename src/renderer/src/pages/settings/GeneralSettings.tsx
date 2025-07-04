import Selector from '@renderer/components/Selector'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useSettings } from '@renderer/hooks/useSettings'
import i18n from '@renderer/i18n'
import { RootState, useAppDispatch } from '@renderer/store'
import {
  setEnableDataCollection,
  setEnableSpellCheck,
  setLanguage,
  setNotificationSettings,
  setProxyMode,
  setProxyUrl as _setProxyUrl,
  setSpellCheckLanguages
} from '@renderer/store/settings'
import { LanguageVarious } from '@renderer/types'
import { NotificationSource } from '@renderer/types/notification'
import { isValidProxyUrl } from '@renderer/utils'
import { defaultLanguage } from '@shared/config/constant'
import { Flex, Input, Switch } from 'antd'
import { FC, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'

import { SettingContainer, SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '.'

const GeneralSettings: FC = () => {
  const {
    language,
    proxyUrl: storeProxyUrl,
    setLaunch,
    setTray,
    launchOnBoot,
    launchToTray,
    trayOnClose,
    tray,
    proxyMode: storeProxyMode,
    enableDataCollection,
    enableSpellCheck,
    disableHardwareAcceleration,
    setDisableHardwareAcceleration
  } = useSettings()
  const [proxyUrl, setProxyUrl] = useState<string | undefined>(storeProxyUrl)
  const { theme } = useTheme()

  const updateTray = (isShowTray: boolean) => {
    setTray(isShowTray)
    //only set tray on close/launch to tray when tray is enabled
    if (!isShowTray) {
      updateTrayOnClose(false)
      updateLaunchToTray(false)
    }
  }

  const updateTrayOnClose = (isTrayOnClose: boolean) => {
    setTray(undefined, isTrayOnClose)
    //in case tray is not enabled, enable it
    if (isTrayOnClose && !tray) {
      updateTray(true)
    }
  }

  const updateLaunchOnBoot = (isLaunchOnBoot: boolean) => {
    setLaunch(isLaunchOnBoot)
  }

  const updateLaunchToTray = (isLaunchToTray: boolean) => {
    setLaunch(undefined, isLaunchToTray)
    if (isLaunchToTray && !tray) {
      updateTray(true)
    }
  }

  const dispatch = useAppDispatch()
  const { t } = useTranslation()

  const onSelectLanguage = (value: LanguageVarious) => {
    dispatch(setLanguage(value))
    localStorage.setItem('language', value)
    window.api.setLanguage(value)
    i18n.changeLanguage(value)
  }

  const handleSpellCheckChange = (checked: boolean) => {
    dispatch(setEnableSpellCheck(checked))
    window.api.setEnableSpellCheck(checked)
  }

  const onSetProxyUrl = () => {
    if (proxyUrl && !isValidProxyUrl(proxyUrl)) {
      window.message.error({ content: t('message.error.invalid.proxy.url'), key: 'proxy-error' })
      return
    }

    dispatch(_setProxyUrl(proxyUrl))
    window.api.setProxy(proxyUrl)
  }

  const proxyModeOptions: { value: 'system' | 'custom' | 'none'; label: string }[] = [
    { value: 'system', label: t('settings.proxy.mode.system') },
    { value: 'custom', label: t('settings.proxy.mode.custom') },
    { value: 'none', label: t('settings.proxy.mode.none') }
  ]

  const onProxyModeChange = (mode: 'system' | 'custom' | 'none') => {
    dispatch(setProxyMode(mode))
    if (mode === 'system') {
      window.api.setProxy('system')
      dispatch(_setProxyUrl(undefined))
    } else if (mode === 'none') {
      window.api.setProxy(undefined)
      dispatch(_setProxyUrl(undefined))
    }
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

  const notificationSettings = useSelector((state: RootState) => state.settings.notification)
  const spellCheckLanguages = useSelector((state: RootState) => state.settings.spellCheckLanguages)

  const handleNotificationChange = (type: NotificationSource, value: boolean) => {
    dispatch(setNotificationSettings({ ...notificationSettings, [type]: value }))
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
    dispatch(setSpellCheckLanguages(selectedLanguages))
    window.api.setSpellCheckLanguages(selectedLanguages)
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
          window.message.error({
            content: (error as Error).message,
            key: 'disable-hardware-acceleration-error'
          })
          return
        }

        // 重启应用
        setTimeout(() => {
          window.api.relaunchApp()
        }, 500)
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
          <SettingRowTitle>{t('settings.general.spell_check')}</SettingRowTitle>
          <Switch checked={enableSpellCheck} onChange={handleSpellCheckChange} />
        </SettingRow>
        {enableSpellCheck && (
          <>
            <SettingDivider />
            <SettingRow>
              <SettingRowTitle>{t('settings.general.spell_check.languages')}</SettingRowTitle>
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
            </SettingRow>
          </>
        )}
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.proxy.mode.title')}</SettingRowTitle>
          <Selector value={storeProxyMode} onChange={onProxyModeChange} options={proxyModeOptions} />
        </SettingRow>
        {storeProxyMode === 'custom' && (
          <>
            <SettingDivider />
            <SettingRow>
              <SettingRowTitle>{t('settings.proxy.title')}</SettingRowTitle>
              <Input
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
          <SettingRowTitle>{t('settings.notification.assistant')}</SettingRowTitle>
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
              dispatch(setEnableDataCollection(v))
              window.api.config.set('enableDataCollection', v)
            }}
          />
        </SettingRow>
      </SettingGroup>
    </SettingContainer>
  )
}

export default GeneralSettings
