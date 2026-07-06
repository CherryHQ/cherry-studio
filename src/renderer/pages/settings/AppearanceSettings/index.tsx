import { Badge, Button, CodeEditor, Combobox, type ComboboxOption, Slider, Switch, Tooltip } from '@cherrystudio/ui'
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
import { formatErrorMessage } from '@renderer/utils/error'
import { cn } from '@renderer/utils/style'
import { ThemeMode } from '@shared/data/preference/preferenceTypes'
import { Monitor, Moon, Sun } from 'lucide-react'
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

const defaultFontPreviewFamily = 'Ubuntu, -apple-system, system-ui, Arial, sans-serif'
const logger = loggerService.withContext('AppearanceSettings')

const AppearanceSettings: FC = () => {
  const { t } = useTranslation()
  const { theme, settedTheme, setTheme } = useTheme()
  const { setTimeoutTimer } = useTimer()
  const { userTheme, setUserTheme } = useUserTheme()
  const { activeCmTheme } = useCodeStyle()

  const [windowStyle, setWindowStyle] = usePreference('ui.window_style')
  const [customCss, setCustomCss] = usePreference('ui.custom_css')
  const [fontSize, setFontSize] = usePreference('chat.message.font_size')
  const [messageFont, setMessageFont] = usePreference('chat.message.font')
  const [useSystemTitleBar, setUseSystemTitleBar] = usePreference('app.use_system_title_bar')

  const [fontList, setFontList] = useState<string[]>([])
  const [fontSizeValue, setFontSizeValue] = useState(fontSize)

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

    void loadSystemFonts()
  }, [])

  useEffect(() => {
    setFontSizeValue(fontSize)
  }, [fontSize])

  const handleWindowStyleChange = useCallback(
    (checked: boolean) => {
      void setWindowStyle(checked ? 'transparent' : 'opaque')
    },
    [setWindowStyle]
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
        <SettingTitle>{t('settings.theme.title')}</SettingTitle>
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
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.messages.use_serif_font')}</SettingRowTitle>
          <Switch
            checked={messageFont === 'serif'}
            onCheckedChange={(checked) => setMessageFont(checked ? 'serif' : 'system')}
          />
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.font_size.title')}</SettingRowTitle>
        </SettingRow>
        <div className="w-full pt-(--cs-size-3xs)">
          <Slider
            value={[fontSizeValue]}
            onValueChange={(values) => setFontSizeValue(values[0])}
            onValueCommit={(values) => setFontSize(values[0])}
            min={12}
            max={22}
            step={1}
            marks={[
              { value: 12, label: <span className="text-xs">A</span> },
              { value: 14, label: <span className="text-xs">{t('common.default')}</span> },
              { value: 22, label: <span className="text-xs">A</span> }
            ]}
          />
        </div>
      </SettingGroup>

      <ChatPreferenceSections variant="display" />

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

const SelectorRow = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex w-full min-w-0 max-w-55 items-center justify-end', className)} {...props} />
)

const WideControlRow = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex w-full min-w-0 max-w-95 items-center justify-end', className)} {...props} />
)

const SelectRow = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex w-full min-w-0 max-w-65 items-center justify-end gap-2', className)} {...props} />
)

export default AppearanceSettings
