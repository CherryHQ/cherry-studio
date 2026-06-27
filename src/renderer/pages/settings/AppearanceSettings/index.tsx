import {
  Badge,
  Button,
  CodeEditor,
  Combobox,
  type ComboboxOption,
  Flex,
  RowFlex,
  SegmentedControl,
  Switch,
  Tooltip
} from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import ChatPreferenceSections from '@renderer/components/chat/settings/ChatPreferenceSections'
import { ResetIcon } from '@renderer/components/Icons'
import Selector from '@renderer/components/Selector'
import { isLinux, isMac, THEME_COLOR_PRESETS } from '@renderer/config/constant'
import { useCodeStyle } from '@renderer/hooks/useCodeStyle'
import { useTheme } from '@renderer/hooks/useTheme'
import { useTimer } from '@renderer/hooks/useTimer'
import useUserTheme from '@renderer/hooks/useUserTheme'
import i18n from '@renderer/i18n'
import { formatErrorMessage } from '@renderer/utils/error'
import { cn } from '@renderer/utils/style'
import type { LanguageVarious, MenuPresentationMode } from '@shared/data/preference/preferenceTypes'
import { ThemeMode } from '@shared/data/preference/preferenceTypes'
import { defaultLanguage } from '@shared/utils/languages'
import { Minus, Monitor, Moon, Plus, Sun } from 'lucide-react'
import type React from 'react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  SettingDescription,
  SettingDivider,
  SettingGroup,
  SettingRow,
  SettingRowTitle,
  SettingsContentColumn,
  SettingTitle
} from '..'
import ThemeColorPicker from './components/ThemeColorPicker'

type SpellCheckOption = { readonly value: string; readonly label: string; readonly flag: string }
type TFunction = (key: string) => string
type MenuPresentationModeChangeOptions = {
  currentMode: MenuPresentationMode
  mode: MenuPresentationMode
  setMenuPresentationMode: (mode: MenuPresentationMode) => Promise<unknown> | unknown
  setTimeoutTimer: (key: string, callback: () => void, delay: number) => void
  t: TFunction
}

const defaultFontPreviewFamily = 'Ubuntu, -apple-system, system-ui, Arial, sans-serif'
const logger = loggerService.withContext('AppearanceSettings')

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

const AppearanceSettings: FC = () => {
  const { t } = useTranslation()
  const { theme, settedTheme, setTheme } = useTheme()
  const { setTimeoutTimer } = useTimer()
  const { userTheme, setUserTheme } = useUserTheme()
  const { activeCmTheme } = useCodeStyle()

  const [language, setLanguage] = usePreference('app.language')
  const [enableSpellCheck, setEnableSpellCheck] = usePreference('app.spell_check.enabled')
  const [spellCheckLanguages, setSpellCheckLanguages] = usePreference('app.spell_check.languages')
  const [windowStyle, setWindowStyle] = usePreference('ui.window_style')
  const [menuPresentationMode, setMenuPresentationMode] = usePreference('menu.presentation_mode')
  const [customCss, setCustomCss] = usePreference('ui.custom_css')
  const [fontSize] = usePreference('chat.message.font_size')
  const [useSystemTitleBar, setUseSystemTitleBar] = usePreference('app.use_system_title_bar')

  const [currentZoom, setCurrentZoom] = useState(1.0)
  const [fontList, setFontList] = useState<string[]>([])

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
    const loadSystemFonts = async () => {
      try {
        const fonts = await window.api.getSystemFonts()
        setFontList(fonts)
      } catch (error) {
        logger.error('Failed to get system fonts', error as Error)
      }
    }

    const updateCurrentZoom = async () => {
      try {
        const factor = await window.api.handleZoomFactor(0)
        setCurrentZoom(factor)
      } catch (error) {
        logger.error('Failed to get current zoom factor', error as Error)
      }
    }

    void loadSystemFonts()
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

  const handleWindowStyleChange = useCallback(
    (checked: boolean) => {
      void setWindowStyle(checked ? 'transparent' : 'opaque')
    },
    [setWindowStyle]
  )

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

  const handleUseSystemTitleBarChange = (checked: boolean) => {
    void window.modal.confirm({
      title: t('settings.use_system_title_bar.confirm.title'),
      content: t('settings.use_system_title_bar.confirm.content'),
      okText: t('common.confirm'),
      cancelText: t('common.cancel'),
      centered: true,
      async onOk() {
        try {
          await setUseSystemTitleBar(checked)
        } catch (error) {
          window.toast.error(formatErrorMessage(error))
          throw error
        }

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

  return (
    <SettingsContentColumn theme={theme}>
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.general.common.sections.display_language')}</SettingTitle>
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
          <SettingRowTitle>{t('settings.theme.title')}</SettingRowTitle>
          <SelectorRow>
            <Selector<ThemeMode>
              size={14}
              style={{ width: '100%' }}
              value={settedTheme}
              onChange={setTheme}
              options={themeOptions}
            />
          </SelectorRow>
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.theme.color_primary')}</SettingRowTitle>
          <WideControlRow>
            <ThemeColorPicker
              value={userTheme.colorPrimary}
              presets={THEME_COLOR_PRESETS}
              onChange={handleColorPrimaryChange}
              ariaLabel={t('settings.theme.color_primary')}
              className="w-full justify-end"
            />
          </WideControlRow>
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
      </SettingGroup>

      <SettingGroup theme={theme}>
        <SettingTitle style={{ justifyContent: 'flex-start', gap: 5 }}>
          {t('settings.display.font.title')} <Badge className="border-primary/20 bg-primary/10 text-primary">New</Badge>
        </SettingTitle>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.display.font.global')}</SettingRowTitle>
          <SelectRow>
            <div className="min-w-0 flex-1">
              <Combobox
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
            </div>
            <Button onClick={() => handleUserFontChange('')} variant="ghost" size="icon">
              <ResetIcon size="14" />
            </Button>
          </SelectRow>
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.display.font.code')}</SettingRowTitle>
          <SelectRow>
            <div className="min-w-0 flex-1">
              <Combobox
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
            </div>
            <Button onClick={() => handleUserCodeFontChange('')} variant="ghost" size="icon">
              <ResetIcon size="14" />
            </Button>
          </SelectRow>
        </SettingRow>
      </SettingGroup>

      <ChatPreferenceSections />

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
    </SettingsContentColumn>
  )
}

const TitleExtra = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('cursor-pointer text-xs underline opacity-70', className)} {...props} />
)

const ZoomButtonGroup = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex w-full min-w-0 max-w-52.5 items-center justify-end', className)} {...props} />
)

const SelectorRow = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex w-full min-w-0 max-w-55 items-center justify-end', className)} {...props} />
)

const WideControlRow = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex w-full min-w-0 max-w-95 items-center justify-end', className)} {...props} />
)

const ZoomValue = ({ className, ...props }: React.ComponentPropsWithoutRef<'span'>) => (
  <span className={cn('mx-1.25 w-10 text-center', className)} {...props} />
)

const SelectRow = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex w-full min-w-0 max-w-65 items-center justify-end gap-2', className)} {...props} />
)

export default AppearanceSettings
