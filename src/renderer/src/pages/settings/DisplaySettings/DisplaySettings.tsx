import { Badge } from '@cherrystudio/ui'
import { CodeEditor } from '@cherrystudio/ui'
import { Switch } from '@cherrystudio/ui'
import { Button } from '@cherrystudio/ui'
import { Tooltip } from '@cherrystudio/ui'
import { SegmentedControl } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { ResetIcon } from '@renderer/components/Icons'
import { isLinux, isMac, THEME_COLOR_PRESETS } from '@renderer/config/constant'
import { useCodeStyle } from '@renderer/context/CodeStyleProvider'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useTimer } from '@renderer/hooks/useTimer'
import useUserTheme from '@renderer/hooks/useUserTheme'
import { cn } from '@renderer/utils/style'
import { DefaultPreferences } from '@shared/data/preference/preferenceSchemas'
import type { AssistantIconType } from '@shared/data/preference/preferenceTypes'
import { ThemeMode } from '@shared/data/preference/preferenceTypes'
import { Select } from 'antd'
import { Minus, Monitor, Moon, Plus, Sun } from 'lucide-react'
import type React from 'react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingContainer, SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '..'
import ThemeColorPicker from '../shared/ThemeColorPicker'
import SidebarIconsManager from './SidebarIconsManager'

const DisplaySettings: FC = () => {
  const [windowStyle, setWindowStyle] = usePreference('ui.window_style')
  const [customCss, setCustomCss] = usePreference('ui.custom_css')
  const [visibleIcons, setVisibleIcons] = usePreference('ui.sidebar.icons.visible')
  const [invisibleIcons, setInvisibleIcons] = usePreference('ui.sidebar.icons.invisible')
  const [topicPosition, setTopicPosition] = usePreference('topic.position')
  const [clickAssistantToShowTopic, setClickAssistantToShowTopic] = usePreference('assistant.click_to_show_topic')
  const [pinTopicsToTop, setPinTopicsToTop] = usePreference('topic.tab.pin_to_top')
  const [showTopicTime, setShowTopicTime] = usePreference('topic.tab.show_time')
  const [assistantIconType, setAssistantIconType] = usePreference('assistant.icon_type')
  const [fontSize] = usePreference('chat.message.font_size')
  const [useSystemTitleBar, setUseSystemTitleBar] = usePreference('app.use_system_title_bar')

  const { theme, settedTheme, setTheme } = useTheme()
  const { t } = useTranslation()
  const { setTimeoutTimer } = useTimer()
  const [currentZoom, setCurrentZoom] = useState(1.0)
  const { userTheme, setUserTheme } = useUserTheme()
  const { activeCmTheme } = useCodeStyle()
  // const [visibleIcons, setVisibleIcons] = useState(sidebarIcons?.visible || DEFAULT_SIDEBAR_ICONS)
  // const [disabledIcons, setDisabledIcons] = useState(sidebarIcons?.disabled || [])
  const [fontList, setFontList] = useState<string[]>([])

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

  const handleColorPrimaryChange = useCallback(
    (colorHex: string) => {
      setUserTheme({
        ...userTheme,
        colorPrimary: colorHex
      })
    },
    [setUserTheme, userTheme]
  )

  const handleReset = useCallback(() => {
    void setVisibleIcons(DefaultPreferences.default['ui.sidebar.icons.visible'])
    void setInvisibleIcons(DefaultPreferences.default['ui.sidebar.icons.invisible'])
  }, [setVisibleIcons, setInvisibleIcons])

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
    // 初始化获取所有系统字体
    void window.api.getSystemFonts().then((fonts: string[]) => {
      setFontList(fonts)
    })

    // 初始化获取当前缩放值
    void window.api.handleZoomFactor(0).then((factor) => {
      setCurrentZoom(factor)
    })

    const handleResize = () => {
      void window.api.handleZoomFactor(0).then((factor) => {
        setCurrentZoom(factor)
      })
    }
    // 添加resize事件监听
    window.addEventListener('resize', handleResize)

    // 清理事件监听，防止内存泄漏
    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [])

  const handleZoomFactor = async (delta: number, reset: boolean = false) => {
    const zoomFactor = await window.api.handleZoomFactor(delta, reset)
    setCurrentZoom(zoomFactor)
  }

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

  const assistantIconTypeOptions = useMemo(
    () => [
      { value: 'model', label: t('settings.assistant.icon.type.model') },
      { value: 'emoji', label: t('settings.assistant.icon.type.emoji') },
      { value: 'none', label: t('settings.assistant.icon.type.none') }
    ],
    [t]
  )

  const renderFontOption = useCallback(
    (font: string) => (
      <Tooltip title={font} placement="left" delay={500}>
        <div
          className="truncate"
          style={{
            fontFamily: font
          }}>
          {font}
        </div>
      </Tooltip>
    ),
    []
  )

  return (
    <SettingContainer theme={theme}>
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.display.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.theme.title')}</SettingRowTitle>
          <SegmentedControl value={settedTheme} onValueChange={setTheme} options={themeOptions} />
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
      </SettingGroup>
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.display.zoom.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.zoom.title')}</SettingRowTitle>
          <ZoomButtonGroup>
            <Button onClick={() => handleZoomFactor(-0.1)} variant="ghost" size="icon-sm">
              <Minus size={13} />
            </Button>
            <ZoomValue>{Math.round(currentZoom * 100)}%</ZoomValue>
            <Button onClick={() => handleZoomFactor(0.1)} variant="ghost" size="icon-sm">
              <Plus size={13} />
            </Button>
            <Button onClick={() => handleZoomFactor(0, true)} className="ml-1.5" variant="ghost" size="icon-sm">
              <ResetIcon size={13} />
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
            <Select
              style={{ width: 280 }}
              placeholder={t('settings.display.font.select')}
              options={[
                {
                  label: (
                    <span style={{ fontFamily: 'Ubuntu, -apple-system, system-ui, Arial, sans-serif' }}>
                      {t('settings.display.font.default')}
                    </span>
                  ),
                  value: ''
                },
                ...fontList.map((font) => ({ label: renderFontOption(font), value: font }))
              ]}
              value={userTheme.userFontFamily || ''}
              onChange={(font) => handleUserFontChange(font)}
              showSearch
              getPopupContainer={(triggerNode) => triggerNode.parentElement || document.body}
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
            <Select
              style={{ width: 280 }}
              placeholder={t('settings.display.font.select')}
              options={[
                {
                  label: (
                    <span style={{ fontFamily: 'Ubuntu, -apple-system, system-ui, Arial, sans-serif' }}>
                      {t('settings.display.font.default')}
                    </span>
                  ),
                  value: ''
                },
                ...fontList.map((font) => ({ label: renderFontOption(font), value: font }))
              ]}
              value={userTheme.userCodeFontFamily || ''}
              onChange={(font) => handleUserCodeFontChange(font)}
              showSearch
              getPopupContainer={(triggerNode) => triggerNode.parentElement || document.body}
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
        <SettingDivider />
        {topicPosition === 'left' && (
          <>
            <SettingRow>
              <SettingRowTitle>{t('settings.advanced.auto_switch_to_topics')}</SettingRowTitle>
              <Switch
                checked={clickAssistantToShowTopic}
                onCheckedChange={(checked) => setClickAssistantToShowTopic(checked)}
              />
            </SettingRow>
            <SettingDivider />
          </>
        )}
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
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.display.assistant.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.assistant.icon.type.label')}</SettingRowTitle>
          <SegmentedControl
            value={assistantIconType}
            onValueChange={(value) => setAssistantIconType(value as AssistantIconType)}
            options={assistantIconTypeOptions}
          />
        </SettingRow>
      </SettingGroup>
      <SettingGroup theme={theme}>
        <SettingTitle
          style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{t('settings.display.sidebar.title')}</span>
          <ResetButtonWrapper>
            <Button onClick={handleReset}>{t('common.reset')}</Button>
          </ResetButtonWrapper>
        </SettingTitle>
        <SettingDivider />
        <SidebarIconsManager
          visibleIcons={visibleIcons}
          invisibleIcons={invisibleIcons}
          setVisibleIcons={setVisibleIcons}
          setInvisibleIcons={setInvisibleIcons}
        />
      </SettingGroup>
      <SettingGroup theme={theme}>
        <SettingTitle>
          {t('settings.display.custom.css.label')}
          <TitleExtra onClick={() => window.api.openWebsite('https://cherrycss.com/')}>
            {t('settings.display.custom.css.cherrycss')}
          </TitleExtra>
        </SettingTitle>
        <SettingDivider />
        <CodeEditor
          theme={activeCmTheme}
          fontSize={fontSize - 1}
          value={customCss}
          language="css"
          placeholder={t('settings.display.custom.css.placeholder')}
          onChange={(value) => setCustomCss(value)}
          height="60vh"
          expanded={false}
          wrapped
          options={{
            autocompletion: true,
            lineNumbers: true,
            foldGutter: true,
            keymap: true
          }}
          style={{
            outline: '0.5px solid var(--color-border)',
            borderRadius: '5px'
          }}
        />
      </SettingGroup>
    </SettingContainer>
  )
}

const TitleExtra = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('cursor-pointer text-xs underline opacity-70', className)} {...props} />
)

const ResetButtonWrapper = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex items-center justify-center', className)} {...props} />
)

const ZoomButtonGroup = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex w-[160px] items-center justify-end', className)} {...props} />
)

const ZoomValue = ({ className, ...props }: React.ComponentPropsWithoutRef<'span'>) => (
  <span className={cn('mx-1 w-8 text-center text-xs', className)} {...props} />
)

const SelectRow = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex w-[380px] items-center justify-end', className)} {...props} />
)

export default DisplaySettings
