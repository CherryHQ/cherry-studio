import {
  Badge,
  Button,
  CodeEditor,
  Combobox,
  type ComboboxOption,
  InfoTooltip,
  Input,
  MenuItem,
  MenuList,
  RowFlex,
  SegmentedControl,
  Switch,
  Tooltip
} from '@cherrystudio/ui'
import { Flex } from '@cherrystudio/ui'
import { useMultiplePreferences, usePreference } from '@data/hooks/usePreference'
import { ResetIcon } from '@renderer/components/Icons'
import Scrollbar from '@renderer/components/Scrollbar'
import Selector from '@renderer/components/Selector'
import { isLinux, isMac, THEME_COLOR_PRESETS } from '@renderer/config/constant'
import { useCodeStyle } from '@renderer/context/CodeStyleProvider'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useTimer } from '@renderer/hooks/useTimer'
import useUserTheme from '@renderer/hooks/useUserTheme'
import i18n from '@renderer/i18n'
import type { NotificationSource } from '@renderer/types/notification'
import { isValidProxyUrl } from '@renderer/utils'
import { formatErrorMessage } from '@renderer/utils/error'
import { cn } from '@renderer/utils/style'
import { defaultByPassRules, defaultLanguage } from '@shared/config/constant'
import type { LanguageVarious } from '@shared/data/preference/preferenceTypes'
import { ThemeMode } from '@shared/data/preference/preferenceTypes'
import { Code, Minus, Monitor, Moon, Palette, Plus, Shield, Sun } from 'lucide-react'
import type React from 'react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingDescription, SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '.'
import {
  settingsContentBodyClassName,
  settingsContentScrollClassName,
  settingsSubmenuItemClassName,
  settingsSubmenuListClassName,
  settingsSubmenuScrollClassName
} from './shared/menuStyles'
import ThemeColorPicker from './shared/ThemeColorPicker'

type SpellCheckOption = { readonly value: string; readonly label: string; readonly flag: string }
type CommonSettingsSection = 'display-language' | 'system-startup' | 'privacy-advanced' | 'custom-css'

const defaultFontPreviewFamily = 'Ubuntu, -apple-system, system-ui, Arial, sans-serif'

const spellCheckLanguageOptions: readonly SpellCheckOption[] = [
  { value: 'en-US', label: 'English (US)', flag: '🇺🇸' },
  { value: 'es', label: 'Español', flag: '🇪🇸' },
  { value: 'fr', label: 'Français', flag: '🇫🇷' },
  { value: 'de', label: 'Deutsch', flag: '🇩🇪' },
  { value: 'it', label: 'Italiano', flag: '🇮🇹' },
  { value: 'pt', label: 'Português', flag: '🇵🇹' },
  { value: 'ru', label: 'Русский', flag: '🇷🇺' },
  { value: 'nl', label: 'Nederlands', flag: '🇳🇱' },
  { value: 'pl', label: 'Polski', flag: '🇵🇱' },
  { value: 'sk', label: 'Slovenčina', flag: '🇸🇰' },
  { value: 'el', label: 'Ελληνικά', flag: '🇬🇷' }
]

const CommonSettings: FC = () => {
  const { t } = useTranslation()
  const { theme, settedTheme, setTheme } = useTheme()
  const { setTimeoutTimer } = useTimer()
  const { userTheme, setUserTheme } = useUserTheme()
  const { activeCmTheme } = useCodeStyle()

  const [activeSection, setActiveSection] = useState<CommonSettingsSection>('display-language')
  const [language, setLanguage] = usePreference('app.language')
  const [disableHardwareAcceleration, setDisableHardwareAcceleration] = usePreference(
    'BootConfig.app.disable_hardware_acceleration'
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
  const [windowStyle, setWindowStyle] = usePreference('ui.window_style')
  const [customCss, setCustomCss] = usePreference('ui.custom_css')
  const [topicPosition, setTopicPosition] = usePreference('topic.position')
  const [clickAssistantToShowTopic, setClickAssistantToShowTopic] = usePreference('assistant.click_to_show_topic')
  const [pinTopicsToTop, setPinTopicsToTop] = usePreference('topic.tab.pin_to_top')
  const [showTopicTime, setShowTopicTime] = usePreference('topic.tab.show_time')
  const [fontSize] = usePreference('chat.message.font_size')
  const [useSystemTitleBar, setUseSystemTitleBar] = usePreference('app.use_system_title_bar')
  const [notificationSettings, setNotificationSettings] = useMultiplePreferences({
    assistant: 'app.notification.assistant.enabled',
    backup: 'app.notification.backup.enabled',
    knowledge: 'app.notification.knowledge.enabled'
  })

  const [proxyUrl, setProxyUrl] = useState<string>(storeProxyUrl)
  const [proxyBypassRules, setProxyBypassRules] = useState<string>(storeProxyBypassRules)
  const [currentZoom, setCurrentZoom] = useState(1.0)
  const [fontList, setFontList] = useState<string[]>([])

  const sectionItems = useMemo(
    () => [
      {
        key: 'display-language' as const,
        label: t('settings.general.common.sections.display_language'),
        icon: <Palette />
      },
      {
        key: 'system-startup' as const,
        label: t('settings.general.common.sections.system_startup'),
        icon: <Monitor />
      },
      {
        key: 'privacy-advanced' as const,
        label: t('settings.general.common.sections.privacy_advanced'),
        icon: <Shield />
      },
      {
        key: 'custom-css' as const,
        label: t('settings.general.common.sections.custom_css'),
        icon: <Code />
      }
    ],
    [t]
  )

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
    { value: 'pt-PT', label: 'Português', flag: '🇵🇹' },
    { value: 'ro-RO', label: 'Română', flag: '🇷🇴' },
    { value: 'vi-VN', label: 'Tiếng Việt', flag: '🇻🇳' }
  ]

  const proxyModeOptions: { value: 'system' | 'custom' | 'none'; label: string }[] = [
    { value: 'system', label: t('settings.proxy.mode.system') },
    { value: 'custom', label: t('settings.proxy.mode.custom') },
    { value: 'none', label: t('settings.proxy.mode.none') }
  ]

  const themeOptions = useMemo(
    () => [
      {
        value: ThemeMode.light,
        label: (
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <Sun size={16} />
            <span>{t('settings.theme.light')}</span>
          </div>
        )
      },
      {
        value: ThemeMode.dark,
        label: (
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <Moon size={16} />
            <span>{t('settings.theme.dark')}</span>
          </div>
        )
      },
      {
        value: ThemeMode.system,
        label: (
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <Monitor size={16} />
            <span>{t('settings.theme.system')}</span>
          </div>
        )
      }
    ],
    [t]
  )

  useEffect(() => {
    void window.api.getSystemFonts().then((fonts: string[]) => {
      setFontList(fonts)
    })

    void window.api.handleZoomFactor(0).then((factor) => {
      setCurrentZoom(factor)
    })

    const handleResize = () => {
      void window.api.handleZoomFactor(0).then((factor) => {
        setCurrentZoom(factor)
      })
    }

    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [])

  const onSelectLanguage = (value: LanguageVarious) => {
    void i18n.changeLanguage(value)
    void setLanguage(value)
  }

  const handleNotificationChange = (type: NotificationSource, value: boolean) => {
    void setNotificationSettings({ [type]: value })
  }

  const handleSpellCheckChange = (checked: boolean) => {
    void setEnableSpellCheck(checked)
    void window.api.setEnableSpellCheck(checked)
  }

  const handleSpellCheckLanguagesChange = (selectedLanguages: string[]) => {
    void setSpellCheckLanguages(selectedLanguages)
  }

  const handleWindowStyleChange = useCallback(
    (checked: boolean) => {
      void setWindowStyle(checked ? 'transparent' : 'opaque')
    },
    [setWindowStyle]
  )

  const handleUseSystemTitleBarChange = (checked: boolean) => {
    window.modal.confirm({
      title: t('settings.use_system_title_bar.confirm.title'),
      content: t('settings.use_system_title_bar.confirm.content'),
      okText: t('common.confirm'),
      cancelText: t('common.cancel'),
      centered: true,
      onOk() {
        void setUseSystemTitleBar(checked)
        setTimeoutTimer(
          'handleUseSystemTitleBarChange',
          () => {
            void window.api.application.relaunch()
          },
          500
        )
      }
    })
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
          void setDisableHardwareAcceleration(checked)
        } catch (error) {
          window.toast.error(formatErrorMessage(error))
          return
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

  const handleZoomFactor = async (delta: number, reset: boolean = false) => {
    const zoomFactor = await window.api.handleZoomFactor(delta, reset)
    setCurrentZoom(zoomFactor)
  }

  const handleColorPrimaryChange = useCallback(
    (colorHex: string) => {
      setUserTheme({
        ...userTheme,
        colorPrimary: colorHex
      })
    },
    [setUserTheme, userTheme]
  )

  const handleUserFontChange = useCallback(
    (value: string) => {
      setUserTheme({
        ...userTheme,
        userFontFamily: value
      })
    },
    [setUserTheme, userTheme]
  )

  const handleUserCodeFontChange = useCallback(
    (value: string) => {
      setUserTheme({
        ...userTheme,
        userCodeFontFamily: value
      })
    },
    [setUserTheme, userTheme]
  )

  const fontOptions = useMemo<ComboboxOption[]>(
    () => [
      {
        label: t('settings.display.font.default'),
        value: ''
      },
      ...fontList.map((font) => ({ label: font, value: font }))
    ],
    [fontList, t]
  )

  const renderFontOption = useCallback((option: ComboboxOption) => {
    const fontFamily = option.value || defaultFontPreviewFamily

    return (
      <Tooltip title={option.label} placement="left" delay={500}>
        <div className="truncate" style={{ fontFamily }}>
          {option.label}
        </div>
      </Tooltip>
    )
  }, [])

  const handleFontComboboxChange = useCallback((value: string | string[], onChange: (font: string) => void) => {
    onChange(Array.isArray(value) ? '' : value)
  }, [])

  const handleUserFontComboboxChange = useCallback(
    (value: string | string[]) => {
      handleFontComboboxChange(value, handleUserFontChange)
    },
    [handleFontComboboxChange, handleUserFontChange]
  )

  const handleUserCodeFontComboboxChange = useCallback(
    (value: string | string[]) => {
      handleFontComboboxChange(value, handleUserCodeFontChange)
    },
    [handleFontComboboxChange, handleUserCodeFontChange]
  )

  const renderDisplayLanguageSection = () => (
    <>
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.general.common.sections.display_language')}</SettingTitle>
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
          <SettingRowTitle>{t('settings.theme.title')}</SettingRowTitle>
          <Selector<ThemeMode> size={14} value={settedTheme} onChange={setTheme} options={themeOptions} />
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.theme.color_primary')}</SettingRowTitle>
          <ThemeColorPicker
            value={userTheme.colorPrimary}
            presets={THEME_COLOR_PRESETS}
            onChange={handleColorPrimaryChange}
            ariaLabel={t('settings.theme.color_primary')}
          />
        </SettingRow>
        {isMac && (
          <>
            <SettingDivider />
            <SettingRow>
              <SettingRowTitle>{t('settings.theme.window.style.transparent')}</SettingRowTitle>
              <Switch checked={windowStyle === 'transparent'} onCheckedChange={handleWindowStyleChange} />
            </SettingRow>
          </>
        )}
        {isLinux && (
          <>
            <SettingDivider />
            <SettingRow>
              <SettingRowTitle>{t('settings.use_system_title_bar.title')}</SettingRowTitle>
              <Switch checked={useSystemTitleBar} onCheckedChange={handleUseSystemTitleBarChange} />
            </SettingRow>
          </>
        )}
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.zoom.title')}</SettingRowTitle>
          <ZoomButtonGroup>
            <Button onClick={() => handleZoomFactor(-0.1)} variant="ghost" size="icon">
              <Minus size="14" />
            </Button>
            <ZoomValue>{Math.round(currentZoom * 100)}%</ZoomValue>
            <Button onClick={() => handleZoomFactor(0.1)} variant="ghost" size="icon">
              <Plus size="14" />
            </Button>
            <Button onClick={() => handleZoomFactor(0, true)} className="ml-2" variant="ghost" size="icon">
              <ResetIcon size="14" />
            </Button>
          </ZoomButtonGroup>
        </SettingRow>
      </SettingGroup>

      <SettingGroup theme={theme}>
        <SettingTitle style={{ justifyContent: 'flex-start', gap: 5 }}>
          {t('settings.display.font.title')} <Badge className="border-primary/20 bg-primary/10 text-primary">New</Badge>
        </SettingTitle>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.display.font.global')}</SettingRowTitle>
          <SelectRow>
            <Combobox
              width={280}
              placeholder={t('settings.display.font.select')}
              emptyText={t('common.no_results')}
              options={fontOptions}
              value={userTheme.userFontFamily || ''}
              onChange={handleUserFontComboboxChange}
              renderOption={renderFontOption}
              searchPlacement="trigger"
              triggerStyle={{ fontFamily: userTheme.userFontFamily || defaultFontPreviewFamily }}
              popoverClassName="max-h-[320px] overflow-y-auto"
            />
            <Button onClick={() => handleUserFontChange('')} className="ml-2" variant="ghost" size="icon">
              <ResetIcon size="14" />
            </Button>
          </SelectRow>
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.display.font.code')}</SettingRowTitle>
          <SelectRow>
            <Combobox
              width={280}
              placeholder={t('settings.display.font.select')}
              emptyText={t('common.no_results')}
              options={fontOptions}
              value={userTheme.userCodeFontFamily || ''}
              onChange={handleUserCodeFontComboboxChange}
              renderOption={renderFontOption}
              searchPlacement="trigger"
              triggerStyle={{ fontFamily: userTheme.userCodeFontFamily || defaultFontPreviewFamily }}
              popoverClassName="max-h-[320px] overflow-y-auto"
            />
            <Button onClick={() => handleUserCodeFontChange('')} className="ml-2" variant="ghost" size="icon">
              <ResetIcon size="14" />
            </Button>
          </SelectRow>
        </SettingRow>
      </SettingGroup>

      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.display.topic.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.topic.position.label')}</SettingRowTitle>
          <SegmentedControl
            value={topicPosition || 'right'}
            onValueChange={setTopicPosition}
            options={[
              { value: 'left', label: t('settings.topic.position.left') },
              { value: 'right', label: t('settings.topic.position.right') }
            ]}
          />
        </SettingRow>
        {topicPosition === 'left' && (
          <>
            <SettingDivider />
            <SettingRow>
              <SettingRowTitle>{t('settings.advanced.auto_switch_to_topics')}</SettingRowTitle>
              <Switch
                checked={clickAssistantToShowTopic}
                onCheckedChange={(checked) => setClickAssistantToShowTopic(checked)}
              />
            </SettingRow>
          </>
        )}
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.topic.show.time')}</SettingRowTitle>
          <Switch checked={showTopicTime} onCheckedChange={(checked) => setShowTopicTime(checked)} />
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.topic.pin_to_top')}</SettingRowTitle>
          <Switch checked={pinTopicsToTop} onCheckedChange={(checked) => setPinTopicsToTop(checked)} />
        </SettingRow>
      </SettingGroup>
    </>
  )

  const renderSystemStartupSection = () => (
    <>
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
        <SettingTitle>{t('settings.general.spell_check.label')}</SettingTitle>
        <SettingDivider />
        <SettingRow>
          <RowFlex className="mr-4 flex-1 items-center justify-between">
            <SettingRowTitle>{t('settings.general.spell_check.label')}</SettingRowTitle>
            {enableSpellCheck && !isMac && (
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
          <Switch checked={enableSpellCheck} onCheckedChange={handleSpellCheckChange} />
        </SettingRow>
      </SettingGroup>
    </>
  )

  const renderPrivacyAdvancedSection = () => (
    <>
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
            checked={notificationSettings.assistant}
            onCheckedChange={(v) => handleNotificationChange('assistant', v)}
          />
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.notification.backup')}</SettingRowTitle>
          <Switch
            checked={notificationSettings.backup}
            onCheckedChange={(v) => handleNotificationChange('backup', v)}
          />
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.notification.knowledge_embed')}</SettingRowTitle>
          <Switch
            checked={notificationSettings.knowledge}
            onCheckedChange={(v) => handleNotificationChange('knowledge', v)}
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.privacy.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.privacy.enable_privacy_mode')}</SettingRowTitle>
          <Switch
            checked={enableDataCollection}
            onCheckedChange={(v) => {
              void setEnableDataCollection(v)
              void window.api.config.set('enableDataCollection', v)
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
          <Switch checked={enableDeveloperMode} onCheckedChange={setEnableDeveloperMode} />
        </SettingRow>
      </SettingGroup>
    </>
  )

  const renderCustomCssSection = () => (
    <>
      <SettingGroup theme={theme}>
        <SettingTitle>
          {t('settings.display.custom.css.label')}
          <TitleExtra onClick={() => window.api.openWebsite('https://cherrycss.com/')}>
            {t('settings.display.custom.css.cherrycss')}
          </TitleExtra>
        </SettingTitle>
        <SettingDescription>{t('settings.display.custom.css.placeholder')}</SettingDescription>
        <div className="mt-4 overflow-hidden rounded-lg border border-border/60">
          <CodeEditor
            theme={activeCmTheme}
            fontSize={fontSize - 1}
            value={customCss}
            language="css"
            placeholder={t('settings.display.custom.css.placeholder')}
            onChange={(value) => setCustomCss(value)}
            height="56vh"
            expanded={false}
            wrapped
            options={{
              autocompletion: true,
              lineNumbers: true,
              foldGutter: true,
              keymap: true
            }}
          />
        </div>
      </SettingGroup>
    </>
  )

  const renderSectionContent = () => {
    switch (activeSection) {
      case 'display-language':
        return renderDisplayLanguageSection()
      case 'system-startup':
        return renderSystemStartupSection()
      case 'privacy-advanced':
        return renderPrivacyAdvancedSection()
      case 'custom-css':
        return renderCustomCssSection()
      default:
        return null
    }
  }

  return (
    <div className="flex flex-1" data-theme-mode={theme}>
      <div className="flex h-[calc(100vh-var(--navbar-height)-6px)] w-full flex-1 flex-row overflow-hidden">
        <Scrollbar className={settingsSubmenuScrollClassName}>
          <MenuList className={settingsSubmenuListClassName}>
            <div className="px-2.5 pt-1 pb-2 font-medium text-foreground-muted text-xs">
              {t('settings.general.common.title')}
            </div>
            {sectionItems.map((item) => (
              <MenuItem
                key={item.key}
                label={item.label}
                icon={item.icon}
                active={activeSection === item.key}
                onClick={() => setActiveSection(item.key)}
                className={settingsSubmenuItemClassName}
              />
            ))}
          </MenuList>
        </Scrollbar>

        <Scrollbar className={settingsContentScrollClassName}>
          <div className={settingsContentBodyClassName}>{renderSectionContent()}</div>
        </Scrollbar>
      </div>
    </div>
  )
}

const TitleExtra = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('cursor-pointer text-xs underline opacity-70', className)} {...props} />
)

const ZoomButtonGroup = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex w-[210px] items-center justify-end', className)} {...props} />
)

const ZoomValue = ({ className, ...props }: React.ComponentPropsWithoutRef<'span'>) => (
  <span className={cn('mx-1.25 w-10 text-center', className)} {...props} />
)

const SelectRow = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex w-[380px] items-center justify-end', className)} {...props} />
)

export default CommonSettings
