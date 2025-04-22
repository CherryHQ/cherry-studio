import { useTheme } from '@renderer/context/ThemeProvider'
import { useSettings } from '@renderer/hooks/useSettings'
import i18n from '@renderer/i18n'
import { useAppDispatch } from '@renderer/store'
import { setEnableDataCollection, setLanguage } from '@renderer/store/settings'
import { setProxyMode, setProxyUrl as _setProxyUrl } from '@renderer/store/settings'
import { LanguageVarious } from '@renderer/types'
import { isValidProxyUrl } from '@renderer/utils'
import { defaultLanguage } from '@shared/config/constant'
import { Input, Select, Space, Switch } from 'antd'
import { FC, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingContainer, SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '.'

const GeneralSettings: FC = () => {
  const {
    language,
    proxyUrl: storeProxyUrl,
    theme,
    setLaunch,
    setTray,
    launchOnBoot,
    launchToTray,
    trayOnClose,
    tray,
    proxyMode: storeProxyMode,
    enableDataCollection
  } = useSettings()
  const [proxyUrl, setProxyUrl] = useState<string | undefined>(storeProxyUrl)
  const { theme: themeMode } = useTheme()

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

  const onSetProxyUrl = () => {
    if (proxyUrl && !isValidProxyUrl(proxyUrl)) {
      window.message.error({ content: t('message.error.invalid.proxy.url'), key: 'proxy-error' })
      return
    }

    dispatch(_setProxyUrl(proxyUrl))
    window.api.setProxy(proxyUrl)
  }

  const proxyModeOptions = [
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

  return (
    <SettingContainer theme={themeMode}>
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.general.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('common.language')}</SettingRowTitle>
          <Select defaultValue={language || defaultLanguage} style={{ width: 180 }} onChange={onSelectLanguage}>
            {languagesOptions.map((lang) => (
              <Select.Option key={lang.value} value={lang.value}>
                <Space.Compact direction="horizontal" block>
                  <Space.Compact block>{lang.label}</Space.Compact>
                  <span role="img" aria-label={lang.flag}>
                    {lang.flag}
                  </span>
                </Space.Compact>
              </Select.Option>
            ))}
          </Select>
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.proxy.mode.title')}</SettingRowTitle>
          <Select
            value={storeProxyMode}
            style={{ width: 180 }}
            onChange={onProxyModeChange}
            options={proxyModeOptions}
          />
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
          <Switch value={enableDataCollection} onChange={(v) => dispatch(setEnableDataCollection(v))} />
        </SettingRow>
      </SettingGroup>
    </SettingContainer>
  )
}

export default GeneralSettings
