import {
  Badge,
  Button,
  CodeEditor,
  Combobox,
  type ComboboxOption,
  EditableNumber,
  Flex,
  InfoTooltip,
  SegmentedControl,
  Switch,
  Tooltip
} from '@cherrystudio/ui'
import { useMultiplePreferences, usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import ChatPreferenceSections from '@renderer/components/chat/settings/ChatPreferenceSections'
import ResetIcon from '@renderer/components/icons/ResetIcon'
import Selector from '@renderer/components/Selector'
import {
  SettingDescription,
  SettingDivider,
  SettingGroup,
  SettingRow,
  SettingRowTitle,
  SettingsContentColumn,
  SettingTitle
} from '@renderer/components/SettingsPrimitives'
import { useCodeStyle } from '@renderer/hooks/useCodeStyle'
import { useTheme } from '@renderer/hooks/useTheme'
import { useTimer } from '@renderer/hooks/useTimer'
import useUserTheme from '@renderer/hooks/useUserTheme'
import i18n from '@renderer/i18n/resolver'
import { ipcApi } from '@renderer/ipc'
import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import { formatErrorMessage } from '@renderer/utils/error'
import { isLinux, isMac } from '@renderer/utils/platform'
import { cn } from '@renderer/utils/style'
import type { LanguageVarious, MenuPresentationMode } from '@shared/data/preference/preferenceTypes'
import { ThemeMode } from '@shared/data/preference/preferenceTypes'
import { defaultLanguage } from '@shared/utils/languages'
import { Minus, Monitor, Moon, Plus, Sun } from 'lucide-react'
import type React from 'react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import ThemeColorPicker from './components/ThemeColorPicker'

const DEFAULT_COLOR_PRIMARY = '#00b96b'
const DEFAULT_ZOOM_FACTOR = 1
const appearanceSectionClassName = 'border-t-0 pt-0'
const THEME_COLOR_PRESETS = [
  DEFAULT_COLOR_PRIMARY,
  '#EF4444', // Red
  '#F59E0B', // Amber
  '#3B82F6', // Blue
  '#8B5CF6' // Purple
]

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

export async function confirmMenuPresentationModeChange({
  currentMode,
  mode,
  setMenuPresentationMode,
  setTimeoutTimer,
  t
}: MenuPresentationModeChangeOptions): Promise<void> {
  if (mode === currentMode) return

  const confirmed = await popup.confirm({
    title: t('settings.general.common.menu.presentation_mode.restart.title'),
    content: t('settings.general.common.menu.presentation_mode.restart.content'),
    okText: t('common.confirm'),
    cancelText: t('common.cancel'),
    centered: true
  })
  if (!confirmed) return

  try {
    await setMenuPresentationMode(mode)
  } catch (error) {
    toast.error(formatErrorMessage(error))
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

const AppearanceSettings: FC = () => {
  const { t } = useTranslation()
  const { theme, settedTheme, setTheme } = useTheme()
  const { setTimeoutTimer } = useTimer()
  const { userTheme, setUserTheme } = useUserTheme()
  const { activeCmTheme } = useCodeStyle()

  const [language, setLanguage] = usePreference('app.language')
  const [windowStyle, setWindowStyle] = usePreference('ui.window_style')
  const [menuPresentationMode, setMenuPresentationMode] = usePreference('menu.presentation_mode')
  const [customCss, setCustomCss] = usePreference('ui.custom_css')
  const [fontSize] = usePreference('chat.message.font_size')
  const [useSystemTitleBar, setUseSystemTitleBar] = usePreference('app.use_system_title_bar')
  const [codeExecution, setCodeExecution] = useMultiplePreferences({
    enabled: 'chat.code.execution.enabled',
    timeoutMinutes: 'chat.code.execution.timeout_minutes'
  })
  const [codeImageTools, setCodeImageTools] = usePreference('chat.code.image_tools')

  const [currentZoom, setCurrentZoom] = useState(1.0)
  const [fontList, setFontList] = useState<string[]>([])
  const isDefaultZoom = Math.abs(currentZoom - DEFAULT_ZOOM_FACTOR) < 0.001

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
        const fonts = await ipcApi.request('system.get_fonts')
        setFontList(fonts)
      } catch (error) {
        logger.error('Failed to get system fonts', error as Error)
      }
    }

    const updateCurrentZoom = async () => {
      try {
        const factor = await ipcApi.request('app.adjust_zoom', { delta: 0 })
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
      void confirmMenuPresentationModeChange({
        currentMode: menuPresentationMode,
        mode,
        setMenuPresentationMode,
        setTimeoutTimer,
        t
      })
    },
    [menuPresentationMode, setMenuPresentationMode, setTimeoutTimer, t]
  )

  const handleUseSystemTitleBarChange = async (checked: boolean) => {
    const confirmed = await popup.confirm({
      title: t('settings.use_system_title_bar.confirm.title'),
      content: t('settings.use_system_title_bar.confirm.content'),
      okText: t('common.confirm'),
      cancelText: t('common.cancel'),
      centered: true
    })
    if (!confirmed) return

    try {
      await setUseSystemTitleBar(checked)
    } catch (error) {
      toast.error(formatErrorMessage(error))
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

  const handleZoomFactor = async (delta: number, reset: boolean = false) => {
    const zoomFactor = await ipcApi.request('app.adjust_zoom', { delta, reset })
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
      <Tooltip title={option.label} placement="left" delay={500} fullWidthTrigger>
        <div className="w-full min-w-0 truncate" style={{ fontFamily }}>
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
    <SettingsContentColumn theme={theme} innerClassName="[&>*+*]:mt-8">
      <SettingGroup theme={theme} className={appearanceSectionClassName}>
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
            {!isDefaultZoom && (
              <Button onClick={() => handleZoomFactor(0, true)} variant="ghost" size="icon">
                <ResetIcon size="14" />
              </Button>
            )}
            <Button onClick={() => handleZoomFactor(-0.1)} variant="ghost" size="icon">
              <Minus size="14" />
            </Button>
            <ZoomValue>{Math.round(currentZoom * 100)}%</ZoomValue>
            <Button onClick={() => handleZoomFactor(0.1)} variant="ghost" size="icon">
              <Plus size="14" />
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
        {isMac && (
          <>
            <SettingDivider />
            <SettingRow>
              <SettingRowTitle>{t('settings.theme.window.style.transparent')}</SettingRowTitle>
              <Switch checked={windowStyle === 'transparent'} onCheckedChange={handleWindowStyleChange} />
            </SettingRow>
          </>
        )}
      </SettingGroup>

      <SettingGroup theme={theme} className={appearanceSectionClassName}>
        <SettingTitle style={{ justifyContent: 'flex-start', gap: 5 }}>
          {t('settings.display.font.title')} <Badge className="border-primary/20 bg-primary/10 text-primary">New</Badge>
        </SettingTitle>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.display.font.global')}</SettingRowTitle>
          <SelectRow>
            {userTheme.userFontFamily && (
              <Button onClick={() => handleUserFontChange('')} variant="ghost" size="icon">
                <ResetIcon size="14" />
              </Button>
            )}
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
                popoverClassName="max-h-[320px] w-(--radix-popover-trigger-width) overflow-y-auto"
              />
            </div>
          </SelectRow>
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.display.font.code')}</SettingRowTitle>
          <SelectRow>
            {userTheme.userCodeFontFamily && (
              <Button onClick={() => handleUserCodeFontChange('')} variant="ghost" size="icon">
                <ResetIcon size="14" />
              </Button>
            )}
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
                popoverClassName="max-h-[320px] w-(--radix-popover-trigger-width) overflow-y-auto"
              />
            </div>
          </SelectRow>
        </SettingRow>
      </SettingGroup>

      <ChatPreferenceSections sectionClassName={appearanceSectionClassName} />

      <SettingGroup theme={theme} className={appearanceSectionClassName}>
        <SettingTitle>{t('chat.settings.code_execution.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow>
          <Flex className="items-center gap-1">
            <SettingRowTitle>{t('chat.settings.code_execution.title')}</SettingRowTitle>
            <InfoTooltip content={t('chat.settings.code_execution.tip')} />
          </Flex>
          <Switch
            checked={codeExecution.enabled}
            onCheckedChange={(checked) => setCodeExecution({ enabled: checked })}
          />
        </SettingRow>
        {codeExecution.enabled && (
          <>
            <SettingDivider />
            <SettingRow>
              <Flex className="items-center gap-1">
                <SettingRowTitle>{t('chat.settings.code_execution.timeout_minutes.label')}</SettingRowTitle>
                <InfoTooltip content={t('chat.settings.code_execution.timeout_minutes.tip')} />
              </Flex>
              <EditableNumber
                size="small"
                className="w-20 text-sm"
                min={1}
                max={60}
                step={1}
                value={codeExecution.timeoutMinutes}
                onChange={(value) => setCodeExecution({ timeoutMinutes: value ?? 1 })}
              />
            </SettingRow>
          </>
        )}
        <SettingDivider />
        <SettingRow>
          <Flex className="items-center gap-1">
            <SettingRowTitle>{t('chat.settings.code_image_tools.label')}</SettingRowTitle>
            <InfoTooltip content={t('chat.settings.code_image_tools.tip')} />
          </Flex>
          <Switch checked={codeImageTools} onCheckedChange={setCodeImageTools} />
        </SettingRow>
      </SettingGroup>

      <SettingGroup theme={theme} className={appearanceSectionClassName}>
        <SettingTitle>
          {t('settings.display.custom.css.label')}
          <TitleExtra onClick={() => ipcApi.request('system.shell.open_website', 'https://cherrycss.com/')}>
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
