import { isMac } from '@renderer/config/constant'
import { useSettings } from '@renderer/hooks/useSettings'
import i18n from '@renderer/i18n'
import { useAppDispatch } from '@renderer/store'
import { setLanguage } from '@renderer/store/settings'
import { setProxyUrl as _setProxyUrl } from '@renderer/store/settings'
import { LanguageVarious, ThemeMode } from '@renderer/types'
import { isValidProxyUrl } from '@renderer/utils'
import { Input, Select, Space, Switch } from 'antd'
import { FC, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingContainer, SettingDivider, SettingRow, SettingRowTitle, SettingTitle } from '.'

const GeneralSettings: FC = () => {
  const {
    language,
    proxyUrl: storeProxyUrl,
    setTheme,
    theme,
    setTray,
    tray,
    windowStyle,
    setWindowStyle
  } = useSettings()
  const [proxyUrl, setProxyUrl] = useState<string | undefined>(storeProxyUrl)

  const updateTray = (value: boolean) => {
    setTray(value)
    window.api.setTray(value)
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

  const languagesOptions: { value: LanguageVarious; label: string; flag: string }[] = [
    { value: 'zh-CN', label: '中文', flag: '🇨🇳' },
    { value: 'zh-TW', label: '中文（繁体）', flag: '🇹🇼' },
    { value: 'en-US', label: 'English', flag: '🇺🇸' },
    { value: 'ru-RU', label: 'Russian', flag: '🇷🇺' }
  ]

  return (
    <SettingContainer>
      <SettingTitle>{t('settings.general.title')}</SettingTitle>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('common.language')}</SettingRowTitle>
        <Select defaultValue={language || 'en-US'} style={{ width: 180 }} onChange={onSelectLanguage}>
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
        <SettingRowTitle>{t('settings.theme.title')}</SettingRowTitle>
        <Select
          defaultValue={theme}
          style={{ width: 180 }}
          onChange={setTheme}
          options={[
            { value: ThemeMode.light, label: t('settings.theme.light') },
            { value: ThemeMode.dark, label: t('settings.theme.dark') },
            { value: ThemeMode.auto, label: t('settings.theme.auto') }
          ]}
        />
      </SettingRow>
      {isMac && (
        <>
          <SettingDivider />
          <SettingRow>
            <SettingRowTitle>{t('settings.theme.window.style.title')}</SettingRowTitle>
            <Select
              defaultValue={windowStyle || 'opaque'}
              style={{ width: 180 }}
              onChange={setWindowStyle}
              options={[
                { value: 'transparent', label: t('settings.theme.window.style.transparent') },
                { value: 'opaque', label: t('settings.theme.window.style.opaque') }
              ]}
            />
          </SettingRow>
        </>
      )}
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
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.tray.title')}</SettingRowTitle>
        <Switch checked={tray} onChange={(checked) => updateTray(checked)} />
      </SettingRow>
      <SettingDivider />
    </SettingContainer>
  )
}

export default GeneralSettings
