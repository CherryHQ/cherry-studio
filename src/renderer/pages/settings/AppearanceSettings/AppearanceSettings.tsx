import {
  Button,
  CodeEditor,
  Combobox,
  type ComboboxOption,
  Flex,
  InfoTooltip,
  InputNumber,
  SegmentedControl,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Tooltip
} from '@cherrystudio/ui'
import { useMultiplePreferences, usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import ChatPreferenceSections from '@renderer/components/chat/settings/ChatPreferenceSections'
import ResetIcon from '@renderer/components/icons/ResetIcon'
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
import { useSidebarFavorites } from '@renderer/hooks/useSidebarFavorites'
import { useTheme } from '@renderer/hooks/useTheme'
import { useTimer } from '@renderer/hooks/useTimer'
import useUserTheme from '@renderer/hooks/useUserTheme'
import { appLanguageOptions, isAppLanguage } from '@renderer/i18n/languages'
import i18n from '@renderer/i18n/resolver'
import { ipcApi } from '@renderer/ipc'
import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import { formatErrorMessage } from '@renderer/utils/error'
import { isLinux, isMac } from '@renderer/utils/platform'
import { cn } from '@renderer/utils/style'
import type { MenuPresentationMode, TopicTabPosition } from '@shared/data/preference/preferenceTypes'
import { ThemeMode } from '@shared/data/preference/preferenceTypes'
import { hasV1CustomCssMarker } from '@shared/utils/customCssMigration'
import { defaultLanguage } from '@shared/utils/languages'
import { Minus, Monitor, Moon, Plus, Sun } from 'lucide-react'
import type React from 'react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import ThemeColorPicker from './components/ThemeColorPicker'

const DEFAULT_COLOR_PRIMARY = '#00b96b'
const DEFAULT_ZOOM_FACTOR = 1
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

type ThemePreviewOption = {
  icon: typeof Sun
  label: string
  value: ThemeMode
}

const defaultFontPreviewFamily = 'Ubuntu, -apple-system, system-ui, Arial, sans-serif'
const fontComboboxClassName = 'h-8 rounded-md border-border bg-transparent pl-3 pr-8 text-sm dark:bg-input/30'
const logger = loggerService.withContext('AppearanceSettings')

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
  const { appFavorites, setAppPinned } = useSidebarFavorites()
  const isChatAssistantVisible = appFavorites.includes('assistants')

  const [language, setLanguage] = usePreference('app.language')
  const [windowStyle, setWindowStyle] = usePreference('ui.window_style')
  const [menuPresentationMode, setMenuPresentationMode] = usePreference('menu.presentation_mode')
  const [customCss, setCustomCss] = usePreference('ui.custom_css')
  const [fontSize] = usePreference('chat.message.font_size')
  const [useSystemTitleBar, setUseSystemTitleBar] = usePreference('app.use_system_title_bar')
  const [topicListPosition, setTopicListPosition] = usePreference('topic.tab.position')
  const [sessionListPosition, setSessionListPosition] = usePreference('agent.session.position')
  const [codeExecution, setCodeExecution] = useMultiplePreferences({
    enabled: 'chat.code.execution.enabled',
    timeoutMinutes: 'chat.code.execution.timeout_minutes'
  })
  const [codeImageTools, setCodeImageTools] = usePreference('chat.code.image_tools')

  const [currentZoom, setCurrentZoom] = useState(1.0)
  const [fontList, setFontList] = useState<string[]>([])
  const isDefaultZoom = Math.abs(currentZoom - DEFAULT_ZOOM_FACTOR) < 0.001

  const resolvedLanguage = i18n.resolvedLanguage ?? i18n.language
  const displayLanguage = isAppLanguage(language)
    ? language
    : isAppLanguage(resolvedLanguage)
      ? resolvedLanguage
      : defaultLanguage

  const themeOptions: ThemePreviewOption[] = [
    { value: ThemeMode.light, label: t('settings.theme.light'), icon: Sun },
    { value: ThemeMode.dark, label: t('settings.theme.dark'), icon: Moon },
    { value: ThemeMode.system, label: t('settings.theme.system'), icon: Monitor }
  ]

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

  const onSelectLanguage = (value: string) => {
    if (!isAppLanguage(value)) return

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

  const listPositionOptions = useMemo(
    () => [
      { value: 'left' as const, label: t('settings.topic.position.left') },
      { value: 'right' as const, label: t('settings.topic.position.right') }
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
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.theme.title')}</SettingTitle>
        <SettingDivider />
        <div id="setting-appearance-theme-mode" className="scroll-mt-6">
          <ThemePreviewSelector value={settedTheme} options={themeOptions} onChange={setTheme} />
        </div>
        <SettingDivider />
        <SettingRow id="setting-appearance-theme-color-primary" className="scroll-mt-6">
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
      </SettingGroup>

      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.general.common.sections.display_language')}</SettingTitle>
        <SettingDivider />
        <SettingRow id="setting-appearance-display-language" className="scroll-mt-6">
          <SettingRowTitle>{t('common.language')}</SettingRowTitle>
          <SelectorRow>
            <Select value={displayLanguage} onValueChange={onSelectLanguage}>
              <SelectTrigger
                size="sm"
                className="w-full text-sm"
                aria-label={appLanguageOptions.find((lang) => lang.value === displayLanguage)?.label}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="text-sm">
                {appLanguageOptions.map((lang) => (
                  <SelectItem className="text-sm" key={lang.value} value={lang.value}>
                    <Flex className="items-center gap-2">
                      <span role="img" aria-label={lang.flag}>
                        {lang.flag}
                      </span>
                      {lang.label}
                    </Flex>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SelectorRow>
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
        <SettingRow id="setting-appearance-zoom" className="scroll-mt-6">
          <SettingRowTitle>{t('settings.zoom.title')}</SettingRowTitle>
          <ZoomButtonGroup>
            {!isDefaultZoom && (
              <Tooltip content={t('preview.reset')} delay={800}>
                <Button
                  onClick={() => handleZoomFactor(0, true)}
                  variant="ghost"
                  size="icon"
                  aria-label={t('preview.reset')}>
                  <ResetIcon size="14" />
                </Button>
              </Tooltip>
            )}
            <Tooltip content={t('preview.zoom_out')} delay={800}>
              <Button
                onClick={() => handleZoomFactor(-0.1)}
                variant="ghost"
                size="icon"
                aria-label={t('preview.zoom_out')}>
                <Minus size="14" />
              </Button>
            </Tooltip>
            <ZoomValue>{Math.round(currentZoom * 100)}%</ZoomValue>
            <Tooltip content={t('preview.zoom_in')} delay={800}>
              <Button
                onClick={() => handleZoomFactor(0.1)}
                variant="ghost"
                size="icon"
                aria-label={t('preview.zoom_in')}>
                <Plus size="14" />
              </Button>
            </Tooltip>
          </ZoomButtonGroup>
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
        <SettingDivider />
        <SettingRow id="setting-appearance-menu-presentation-mode" className="scroll-mt-6">
          <SettingRowTitle>{t('settings.general.common.menu.presentation_mode.title')}</SettingRowTitle>
          <SegmentedControl<MenuPresentationMode>
            value={menuPresentationMode}
            onValueChange={handleMenuPresentationModeChange}
            options={menuPresentationModeOptions}
            size="sm"
          />
        </SettingRow>
        <SettingDivider />
        <SettingRow id="setting-appearance-chat-list-position" className="scroll-mt-6">
          <SettingRowTitle>{t('settings.display.list_position.chat')}</SettingRowTitle>
          <SegmentedControl<TopicTabPosition>
            value={topicListPosition}
            onValueChange={setTopicListPosition}
            options={listPositionOptions}
            aria-label={t('settings.display.list_position.chat')}
            size="sm"
          />
        </SettingRow>
        <SettingDivider />
        <SettingRow id="setting-appearance-work-list-position" className="scroll-mt-6">
          <SettingRowTitle>{t('settings.display.list_position.work')}</SettingRowTitle>
          <SegmentedControl<TopicTabPosition>
            value={sessionListPosition}
            onValueChange={setSessionListPosition}
            options={listPositionOptions}
            aria-label={t('settings.display.list_position.work')}
            size="sm"
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.display.sidebar.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.display.sidebar.chat.visible')}</SettingRowTitle>
          <Switch
            checked={isChatAssistantVisible}
            disabled={isChatAssistantVisible && appFavorites.length <= 1}
            onCheckedChange={(checked) => setAppPinned('assistants', checked)}
            aria-label={t('settings.display.sidebar.chat.visible')}
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.display.font.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow id="setting-appearance-font-global" className="scroll-mt-6">
          <SettingRowTitle>{t('settings.display.font.global')}</SettingRowTitle>
          <SelectorRow className="gap-2">
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
                className={fontComboboxClassName}
                triggerStyle={{ fontFamily: userTheme.userFontFamily || defaultFontPreviewFamily }}
                popoverClassName="max-h-[320px] w-(--radix-popover-trigger-width) overflow-y-auto"
              />
            </div>
          </SelectorRow>
        </SettingRow>
        <SettingDivider />
        <SettingRow id="setting-appearance-font-code" className="scroll-mt-6">
          <SettingRowTitle>{t('settings.display.font.code')}</SettingRowTitle>
          <SelectorRow className="gap-2">
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
                className={fontComboboxClassName}
                triggerStyle={{ fontFamily: userTheme.userCodeFontFamily || defaultFontPreviewFamily }}
                popoverClassName="max-h-[320px] w-(--radix-popover-trigger-width) overflow-y-auto"
              />
            </div>
          </SelectorRow>
        </SettingRow>
      </SettingGroup>

      <ChatPreferenceSections />

      <SettingGroup theme={theme}>
        <SettingTitle>{t('chat.settings.code_execution.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow id="setting-appearance-code-execution-enabled" className="scroll-mt-6">
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
              <InputNumber
                size="small"
                aria-label={t('chat.settings.code_execution.timeout_minutes.label')}
                className="w-20 text-sm"
                min={1}
                max={60}
                step={1}
                value={codeExecution.timeoutMinutes}
                onBlur={(value) => setCodeExecution({ timeoutMinutes: value ?? 1 })}
              />
            </SettingRow>
          </>
        )}
        <SettingDivider />
        <SettingRow id="setting-appearance-code-image-tools" className="scroll-mt-6">
          <Flex className="items-center gap-1">
            <SettingRowTitle>{t('chat.settings.code_image_tools.label')}</SettingRowTitle>
            <InfoTooltip content={t('chat.settings.code_image_tools.tip')} />
          </Flex>
          <Switch checked={codeImageTools} onCheckedChange={setCodeImageTools} />
        </SettingRow>
      </SettingGroup>

      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.display.custom.css.label')}</SettingTitle>
        {hasV1CustomCssMarker(customCss) && (
          <SettingDescription>{t('settings.display.custom.css.migration_notice')}</SettingDescription>
        )}
        <div
          id="setting-appearance-custom-css"
          className="mt-4 scroll-mt-6 overflow-hidden rounded-lg border border-border-subtle">
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

const ThemePreview = ({ mode }: { mode: ThemeMode }) => {
  if (mode === ThemeMode.system) {
    return (
      <div className="flex aspect-video w-full overflow-hidden rounded-md border border-neutral-400">
        <div className="flex w-1/2 bg-white">
          <div className="w-1/3 border-neutral-200 border-r bg-neutral-100 p-1">
            <div className="size-1.5 rounded-full bg-neutral-400" />
          </div>
          <div className="flex-1 p-1.5">
            <div className="h-1.5 w-3/4 rounded-full bg-neutral-300" />
            <div className="mt-1.5 h-1 w-full rounded-full bg-neutral-200" />
            <div className="mt-1 h-1 w-2/3 rounded-full bg-neutral-200" />
          </div>
        </div>
        <div className="flex w-1/2 bg-neutral-950">
          <div className="w-1/3 border-neutral-700 border-r bg-neutral-900 p-1">
            <div className="size-1.5 rounded-full bg-neutral-500" />
          </div>
          <div className="flex-1 p-1.5">
            <div className="h-1.5 w-3/4 rounded-full bg-neutral-600" />
            <div className="mt-1.5 h-1 w-full rounded-full bg-neutral-800" />
            <div className="mt-1 h-1 w-2/3 rounded-full bg-neutral-800" />
          </div>
        </div>
      </div>
    )
  }

  const isDarkPreview = mode === ThemeMode.dark

  return (
    <div
      className={cn(
        'flex aspect-video w-full overflow-hidden rounded-md border',
        isDarkPreview ? 'border-neutral-700 bg-neutral-950' : 'border-neutral-300 bg-white'
      )}>
      <div
        className={cn(
          'w-1/4 border-r p-1.5',
          isDarkPreview ? 'border-neutral-700 bg-neutral-900' : 'border-neutral-200 bg-neutral-100'
        )}>
        <div className={cn('size-1.5 rounded-full', isDarkPreview ? 'bg-neutral-500' : 'bg-neutral-400')} />
        <div className={cn('mt-1.5 h-1 w-full rounded-full', isDarkPreview ? 'bg-neutral-700' : 'bg-neutral-300')} />
        <div className={cn('mt-1 h-1 w-2/3 rounded-full', isDarkPreview ? 'bg-neutral-700' : 'bg-neutral-300')} />
      </div>
      <div className="flex-1 p-2">
        <div className={cn('h-1.5 w-1/2 rounded-full', isDarkPreview ? 'bg-neutral-600' : 'bg-neutral-300')} />
        <div className={cn('mt-2 h-1 w-full rounded-full', isDarkPreview ? 'bg-neutral-800' : 'bg-neutral-200')} />
        <div className={cn('mt-1 h-1 w-3/4 rounded-full', isDarkPreview ? 'bg-neutral-800' : 'bg-neutral-200')} />
      </div>
    </div>
  )
}

const ThemePreviewSelector = ({
  value,
  options,
  onChange
}: {
  value: ThemeMode
  options: ThemePreviewOption[]
  onChange: (value: ThemeMode) => unknown
}) => (
  <div className="grid w-full grid-cols-3 gap-2">
    {options.map((option) => {
      const Icon = option.icon

      return (
        <button
          key={option.value}
          type="button"
          aria-label={option.label}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className="group min-w-0 cursor-pointer rounded-lg pb-1.5 text-foreground outline-none">
          <div
            className={cn(
              'rounded-lg border bg-background-subtle p-1.5 transition-colors',
              'group-focus-visible:border-ring group-focus-visible:bg-accent',
              value === option.value
                ? 'border-primary ring-2 ring-primary/20'
                : 'border-border group-hover:border-border-strong group-hover:bg-accent'
            )}>
            <ThemePreview mode={option.value} />
          </div>
          <span className="mt-2 flex items-center justify-center gap-1.5 text-sm">
            <Icon className="size-4" />
            <span className="truncate">{option.label}</span>
          </span>
        </button>
      )
    })}
  </div>
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

export default AppearanceSettings
