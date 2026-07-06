import { Button, Flex, InfoTooltip, Input, RowFlex, SegmentedControl, Switch } from '@cherrystudio/ui'
import { useMultiplePreferences, usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import ChatPreferenceSections from '@renderer/components/chat/settings/ChatPreferenceSections'
import { ResetIcon } from '@renderer/components/Icons'
import Selector from '@renderer/components/Selector'
import { defaultByPassRules, isMac } from '@renderer/config/constant'
import { useTheme } from '@renderer/hooks/useTheme'
import { useTimer } from '@renderer/hooks/useTimer'
import i18n from '@renderer/i18n'
import { formatErrorMessage } from '@renderer/utils/error'
import { cn } from '@renderer/utils/style'
import { isValidProxyUrl } from '@renderer/utils/url'
import type { LanguageVarious, MenuPresentationMode } from '@shared/data/preference/preferenceTypes'
import { defaultLanguage } from '@shared/utils/languages'
import { Minus, Plus } from 'lucide-react'
import type React from 'react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingsContentColumn, SettingTitle } from '..'

type SpellCheckOption = { readonly value: string; readonly label: string; readonly flag: string }
type TFunction = (key: string) => string
type MenuPresentationModeChangeOptions = {
  currentMode: MenuPresentationMode
  mode: MenuPresentationMode
  setMenuPresentationMode: (mode: MenuPresentationMode) => Promise<unknown> | unknown
  setTimeoutTimer: (key: string, callback: () => void, delay: number) => void
  t: TFunction
}

const logger = loggerService.withContext('GeneralSettings')

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

export function confirmMenuPresentationModeChange({
  currentMode,
  mode,
  setMenuPresentationMode,
  setTimeoutTimer,
  t
}: MenuPresentationModeChangeOptions): void {
  if (mode === currentMode) return

  void window.modal.confirm({
    title: t('settings.general.common.menu.presentation_mode.restart.title'),
    content: t('settings.general.common.menu.presentation_mode.restart.content'),
    okText: t('common.confirm'),
    cancelText: t('common.cancel'),
    centered: true,
    async onOk() {
      try {
        await setMenuPresentationMode(mode)
      } catch (error) {
        window.toast.error(formatErrorMessage(error))
        throw error
      }

      setTimeoutTimer(
        'handleMenuPresentationModeChange',
        () => {
          void window.api.application.relaunch()
        },
        500
      )
    }
  })
}

const GeneralSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const { setTimeoutTimer } = useTimer()

  const [language, setLanguage] = usePreference('app.language')
  const [enableSpellCheck, setEnableSpellCheck] = usePreference('app.spell_check.enabled')
  const [spellCheckLanguages, setSpellCheckLanguages] = usePreference('app.spell_check.languages')
  const [menuPresentationMode, setMenuPresentationMode] = usePreference('menu.presentation_mode')
  const [notificationSettings, setNotificationSettings] = useMultiplePreferences({
    assistant: 'app.notification.assistant.enabled',
    backup: 'app.notification.backup.enabled',
    knowledge: 'app.notification.knowledge.enabled'
  })
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

  const [currentZoom, setCurrentZoom] = useState(1.0)
  const [proxyUrl, setProxyUrl] = useState<string>(storeProxyUrl)
  const [proxyBypassRules, setProxyBypassRules] = useState<string>(storeProxyBypassRules)

  const displayLanguage = useMemo(() => {
    if (language && languagesOptions.some((opt) => opt.value === language)) {
      return language
    }

    const resolved = i18n.resolvedLanguage ?? i18n.language
    if (resolved && languagesOptions.some((opt) => opt.value === resolved)) {
      return resolved as LanguageVarious
    }

    return defaultLanguage
  }, [language, i18n.resolvedLanguage, i18n.language])

  useEffect(() => {
    const updateCurrentZoom = async () => {
      try {
        const factor = await window.api.handleZoomFactor(0)
        setCurrentZoom(factor)
      } catch (error) {
        logger.error('Failed to get current zoom factor', error as Error)
      }
    }

    void updateCurrentZoom()

    const handleResize = () => {
      void updateCurrentZoom()
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

  const handleSpellCheckChange = (checked: boolean) => {
    void setEnableSpellCheck(checked)
    void window.api.setEnableSpellCheck(checked)
  }

  const handleSpellCheckLanguagesChange = (selectedLanguages: string[]) => {
    void setSpellCheckLanguages(selectedLanguages)
  }

  const menuPresentationModeOptions = useMemo(
    () => [
      { value: 'cherry' as const, label: t('settings.general.common.menu.presentation_mode.cherry') },
      { value: 'native' as const, label: t('settings.general.common.menu.presentation_mode.native') }
    ],
    [t]
  )

  const handleMenuPresentationModeChange = useCallback(
    (mode: MenuPresentationMode) => {
      confirmMenuPresentationModeChange({
        currentMode: menuPresentationMode,
        mode,
        setMenuPresentationMode,
        setTimeoutTimer,
        t
      })
    },
    [menuPresentationMode, setMenuPresentationMode, setTimeoutTimer, t]
  )

  const handleZoomFactor = async (delta: number, reset: boolean = false) => {
    const zoomFactor = await window.api.handleZoomFactor(delta, reset)
    setCurrentZoom(zoomFactor)
  }

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
        <SettingTitle>{t('settings.general.common.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('common.language')}</SettingRowTitle>
          <SelectorRow>
            <Selector
              size={14}
              style={{ width: '100%' }}
              value={displayLanguage}
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
          </SelectorRow>
        </SettingRow>
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
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.general.common.menu.presentation_mode.title')}</SettingRowTitle>
          <SegmentedControl<MenuPresentationMode>
            value={menuPresentationMode}
            onValueChange={handleMenuPresentationModeChange}
            options={menuPresentationModeOptions}
            size="sm"
          />
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.hardware_acceleration.title')}</SettingRowTitle>
          <Switch checked={disableHardwareAcceleration} onCheckedChange={handleHardwareAccelerationChange} />
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.power.prevent_sleep_when_busy')}</SettingRowTitle>
          <Switch checked={preventSleepWhenBusy} onCheckedChange={(checked) => void setPreventSleepWhenBusy(checked)} />
        </SettingRow>
      </SettingGroup>

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
        <SettingTitle>{t('settings.proxy.title')}</SettingTitle>
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
      </SettingGroup>

      <ChatPreferenceSections variant="general" />

      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.notification.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow>
          <Flex className="items-center gap-1">
            <SettingRowTitle>{t('settings.notification.assistant')}</SettingRowTitle>
            <InfoTooltip
              content={t('notification.tip')}
              placement="right"
              iconProps={{ className: 'cursor-pointer' }}
            />
          </Flex>
          <Switch
            checked={notificationSettings.assistant}
            onCheckedChange={(v) => void setNotificationSettings({ assistant: v })}
          />
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.notification.backup')}</SettingRowTitle>
          <Switch
            checked={notificationSettings.backup}
            onCheckedChange={(v) => void setNotificationSettings({ backup: v })}
          />
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.notification.knowledge_embed')}</SettingRowTitle>
          <Switch
            checked={notificationSettings.knowledge}
            onCheckedChange={(v) => void setNotificationSettings({ knowledge: v })}
          />
        </SettingRow>
      </SettingGroup>
    </SettingsContentColumn>
  )
}

const ZoomButtonGroup = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex w-full min-w-0 max-w-52.5 items-center justify-end', className)} {...props} />
)

const SelectorRow = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex w-full min-w-0 max-w-55 items-center justify-end', className)} {...props} />
)

const ZoomValue = ({ className, ...props }: React.ComponentPropsWithoutRef<'span'>) => (
  <span className={cn('mx-1.25 w-10 text-center', className)} {...props} />
)

export default GeneralSettings
