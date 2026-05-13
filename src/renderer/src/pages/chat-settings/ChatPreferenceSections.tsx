import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Slider } from '@cherrystudio/ui'
import { useMultiplePreferences, usePreference } from '@data/hooks/usePreference'
import EditableNumber from '@renderer/components/EditableNumber'
import { useCodeStyle } from '@renderer/context/CodeStyleProvider'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useLanguages } from '@renderer/hooks/translate'
import { CollapsibleSettingGroup } from '@renderer/pages/settings/SettingGroup'
import type { CodeStyleVarious, MathEngine } from '@renderer/types'
import { getSendMessageShortcutLabel } from '@renderer/utils/input'
import type { SendMessageShortcut } from '@shared/data/preference/preferenceTypes'
import { ThemeMode } from '@shared/data/preference/preferenceTypes'
import type { FC } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  SettingDivider,
  SettingGroup,
  SettingRow,
  SettingRowTitleSmall,
  SettingSwitch
} from './settingsPanelPrimitives'

type SelectorItem<T extends string = string> = {
  value: T
  label: string
}

export type ChatPreferenceSectionsFeatures = {
  showPrompt?: boolean
  showMessageOutline?: boolean
  showMultiModelStyle?: boolean
  showInputEstimatedTokens?: boolean
}

interface Props {
  features?: ChatPreferenceSectionsFeatures
}

const ChatPreferenceSections: FC<Props> = ({ features }) => {
  const [messageStyle, setMessageStyle] = usePreference('chat.message.style')
  const [fontSize, setFontSize] = usePreference('chat.message.font_size')
  const [language] = usePreference('app.language')
  const [targetLanguage, setTargetLanguage] = usePreference('chat.input.translate.target_language')
  const [sendMessageShortcut, setSendMessageShortcut] = usePreference('chat.input.send_message_shortcut')
  const [messageFont, setMessageFont] = usePreference('chat.message.font')
  const [showPrompt, setShowPrompt] = usePreference('chat.message.show_prompt')
  const [confirmDeleteMessage, setConfirmDeleteMessage] = usePreference('chat.message.confirm_delete')
  const [confirmRegenerateMessage, setConfirmRegenerateMessage] = usePreference('chat.message.confirm_regenerate')
  const [showTranslateConfirm, setShowTranslateConfirm] = usePreference('chat.input.translate.show_confirm')
  const [enableQuickPanelTriggers, setEnableQuickPanelTriggers] = usePreference(
    'chat.input.quick_panel.triggers_enabled'
  )
  const [messageNavigation, setMessageNavigation] = usePreference('chat.message.navigation_mode')
  const [thoughtAutoCollapse, setThoughtAutoCollapse] = usePreference('chat.message.thought.auto_collapse')
  const [multiModelMessageStyle, setMultiModelMessageStyle] = usePreference('chat.message.multi_model.style')
  const [pasteLongTextAsFile, setPasteLongTextAsFile] = usePreference('chat.input.paste_long_text_as_file')
  const [pasteLongTextThreshold, setPasteLongTextThreshold] = usePreference('chat.input.paste_long_text_threshold')
  const [mathEngine, setMathEngine] = usePreference('chat.message.math.engine')
  const [mathEnableSingleDollar, setMathEnableSingleDollar] = usePreference('chat.message.math.single_dollar')
  const [showInputEstimatedTokens, setShowInputEstimatedTokens] = usePreference('chat.input.show_estimated_tokens')
  const [renderInputMessageAsMarkdown, setRenderInputMessageAsMarkdown] = usePreference(
    'chat.message.render_as_markdown'
  )
  const [autoTranslateWithSpace, setAutoTranslateWithSpace] = usePreference(
    'chat.input.translate.auto_translate_with_space'
  )
  const [showMessageOutline, setShowMessageOutline] = usePreference('chat.message.show_outline')
  const [codeShowLineNumbers, setCodeShowLineNumbers] = usePreference('chat.code.show_line_numbers')
  const [codeCollapsible, setCodeCollapsible] = usePreference('chat.code.collapsible')
  const [codeWrappable, setCodeWrappable] = usePreference('chat.code.wrappable')
  const [codeImageTools, setCodeImageTools] = usePreference('chat.code.image_tools')
  const [codeEditor, setCodeEditor] = useMultiplePreferences({
    enabled: 'chat.code.editor.enabled',
    themeLight: 'chat.code.editor.theme_light',
    themeDark: 'chat.code.editor.theme_dark',
    highlightActiveLine: 'chat.code.editor.highlight_active_line',
    foldGutter: 'chat.code.editor.fold_gutter',
    autocompletion: 'chat.code.editor.autocompletion',
    keymap: 'chat.code.editor.keymap'
  })
  const [codeViewer, setCodeViewer] = useMultiplePreferences({
    themeLight: 'chat.code.viewer.theme_light',
    themeDark: 'chat.code.viewer.theme_dark'
  })
  const [codeExecution, setCodeExecution] = useMultiplePreferences({
    enabled: 'chat.code.execution.enabled',
    timeoutMinutes: 'chat.code.execution.timeout_minutes'
  })
  const [codeFancyBlock, setCodeFancyBlock] = usePreference('chat.code.fancy_block')

  const { theme } = useTheme()
  const { themeNames } = useCodeStyle()
  const [fontSizeValue, setFontSizeValue] = useState(fontSize)
  const { languages, getLabel } = useLanguages()
  const { t } = useTranslation()

  const messageStyleItems = useMemo<SelectorItem<'plain' | 'bubble'>[]>(
    () => [
      { value: 'plain', label: t('message.message.style.plain') },
      { value: 'bubble', label: t('message.message.style.bubble') }
    ],
    [t]
  )

  const messageNavigationItems = useMemo<SelectorItem<'none' | 'buttons' | 'anchor'>[]>(
    () => [
      { value: 'none', label: t('settings.messages.navigation.none') },
      { value: 'buttons', label: t('settings.messages.navigation.buttons') },
      { value: 'anchor', label: t('settings.messages.navigation.anchor') }
    ],
    [t]
  )

  const mathEngineItems = useMemo<SelectorItem<MathEngine>[]>(
    () => [
      { value: 'KaTeX', label: 'KaTeX' },
      { value: 'MathJax', label: 'MathJax' },
      { value: 'none', label: t('settings.math.engine.none') }
    ],
    [t]
  )

  const codeStyleItems = useMemo<SelectorItem<CodeStyleVarious>[]>(
    () => themeNames.map((themeName) => ({ value: themeName, label: themeName })),
    [themeNames]
  )

  const targetLanguageItems = useMemo<SelectorItem<string>[]>(
    () => languages?.map((item) => ({ value: item.langCode, label: getLabel(item) ?? '' })) ?? [],
    [languages, getLabel]
  )

  const sendMessageShortcutItems = useMemo<SelectorItem<SendMessageShortcut>[]>(
    () => [
      { value: 'Enter', label: getSendMessageShortcutLabel('Enter') },
      { value: 'Ctrl+Enter', label: getSendMessageShortcutLabel('Ctrl+Enter') },
      { value: 'Alt+Enter', label: getSendMessageShortcutLabel('Alt+Enter') },
      { value: 'Command+Enter', label: getSendMessageShortcutLabel('Command+Enter') },
      { value: 'Shift+Enter', label: getSendMessageShortcutLabel('Shift+Enter') }
    ],
    []
  )

  const codeStyle = useMemo(() => {
    return codeEditor.enabled
      ? theme === ThemeMode.light
        ? codeEditor.themeLight
        : codeEditor.themeDark
      : theme === ThemeMode.light
        ? codeViewer.themeLight
        : codeViewer.themeDark
  }, [
    codeEditor.enabled,
    codeEditor.themeLight,
    codeEditor.themeDark,
    theme,
    codeViewer.themeLight,
    codeViewer.themeDark
  ])

  const onCodeStyleChange = useCallback(
    (value: CodeStyleVarious) => {
      const field = theme === ThemeMode.light ? 'themeLight' : 'themeDark'
      const action = codeEditor.enabled ? setCodeEditor : setCodeViewer
      void action({ [field]: value })
    },
    [theme, codeEditor.enabled, setCodeEditor, setCodeViewer]
  )

  return (
    <>
      <CollapsibleSettingGroup title={t('settings.messages.title')} defaultExpanded={true}>
        <SettingGroup>
          {features?.showPrompt && (
            <>
              <SettingRow>
                <SettingSwitch
                  checked={showPrompt}
                  onCheckedChange={setShowPrompt}
                  label={t('settings.messages.prompt')}
                />
              </SettingRow>
              <SettingDivider />
            </>
          )}
          <SettingRow>
            <SettingSwitch
              checked={messageFont === 'serif'}
              onCheckedChange={(checked) => setMessageFont(checked ? 'serif' : 'system')}
              label={t('settings.messages.use_serif_font')}
            />
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            <SettingSwitch
              checked={thoughtAutoCollapse}
              onCheckedChange={setThoughtAutoCollapse}
              label={t('chat.settings.thought_auto_collapse.label')}
              hint={t('chat.settings.thought_auto_collapse.tip')}
            />
          </SettingRow>
          {features?.showMessageOutline && (
            <>
              <SettingDivider />
              <SettingRow>
                <SettingSwitch
                  checked={showMessageOutline}
                  onCheckedChange={(checked) => setShowMessageOutline(checked)}
                  label={t('settings.messages.show_message_outline')}
                />
              </SettingRow>
            </>
          )}
          <SettingDivider />
          <SettingRow>
            <SettingRowTitleSmall>{t('message.message.style.label')}</SettingRowTitleSmall>
            <Select value={messageStyle} onValueChange={setMessageStyle}>
              <SelectTrigger size="sm" className="w-45">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {messageStyleItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>
          <SettingDivider />
          {features?.showMultiModelStyle && (
            <>
              <SettingRow>
                <SettingRowTitleSmall>{t('message.message.multi_model_style.label')}</SettingRowTitleSmall>
                <Select value={multiModelMessageStyle} onValueChange={setMultiModelMessageStyle}>
                  <SelectTrigger size="sm" className="w-45">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem key="fold" value="fold">
                      {t('message.message.multi_model_style.fold.label')}
                    </SelectItem>
                    <SelectItem key="vertical" value="vertical">
                      {t('message.message.multi_model_style.vertical')}
                    </SelectItem>
                    <SelectItem key="horizontal" value="horizontal">
                      {t('message.message.multi_model_style.horizontal')}
                    </SelectItem>
                    <SelectItem key="grid" value="grid">
                      {t('message.message.multi_model_style.grid')}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </SettingRow>
              <SettingDivider />
            </>
          )}
          <SettingRow>
            <SettingRowTitleSmall>{t('settings.messages.navigation.label')}</SettingRowTitleSmall>
            <Select value={messageNavigation} onValueChange={setMessageNavigation}>
              <SelectTrigger size="sm" className="w-45">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {messageNavigationItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            <SettingRowTitleSmall>{t('settings.font_size.title')}</SettingRowTitleSmall>
          </SettingRow>
          <div className="w-full pt-[var(--cs-size-3xs)]">
            <Slider
              value={[fontSizeValue]}
              onValueChange={(values) => setFontSizeValue(values[0])}
              onValueCommit={(values) => setFontSize(values[0])}
              min={12}
              max={22}
              step={1}
              marks={[
                { value: 12, label: <span style={{ fontSize: '12px' }}>A</span> },
                { value: 14, label: <span style={{ fontSize: '14px' }}>{t('common.default')}</span> },
                { value: 22, label: <span style={{ fontSize: '18px' }}>A</span> }
              ]}
            />
          </div>
        </SettingGroup>
      </CollapsibleSettingGroup>
      <SettingDivider className="my-0" />
      <CollapsibleSettingGroup title={t('settings.math.title')} defaultExpanded={false}>
        <SettingGroup>
          <SettingRow>
            <SettingRowTitleSmall>{t('settings.math.engine.label')}</SettingRowTitleSmall>
            <Select value={mathEngine} onValueChange={setMathEngine}>
              <SelectTrigger size="sm" className="w-45">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {mathEngineItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            <SettingSwitch
              checked={mathEnableSingleDollar}
              onCheckedChange={setMathEnableSingleDollar}
              label={t('settings.math.single_dollar.label')}
              hint={t('settings.math.single_dollar.tip')}
            />
          </SettingRow>
        </SettingGroup>
      </CollapsibleSettingGroup>
      <SettingDivider className="my-0" />
      <CollapsibleSettingGroup title={t('chat.settings.code.title')} defaultExpanded={false}>
        <SettingGroup>
          <SettingRow>
            <SettingRowTitleSmall>{t('message.message.code_style')}</SettingRowTitleSmall>
            <Select value={codeStyle} onValueChange={onCodeStyleChange}>
              <SelectTrigger size="sm" className="w-45">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {codeStyleItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            <SettingSwitch
              checked={codeFancyBlock}
              onCheckedChange={setCodeFancyBlock}
              label={t('chat.settings.code_fancy_block.label')}
              hint={t('chat.settings.code_fancy_block.tip')}
            />
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            <SettingSwitch
              checked={codeExecution.enabled}
              onCheckedChange={(checked) => setCodeExecution({ enabled: checked })}
              label={t('chat.settings.code_execution.title')}
              hint={t('chat.settings.code_execution.tip')}
            />
          </SettingRow>
          {codeExecution.enabled && (
            <>
              <SettingDivider />
              <SettingRow style={{ paddingLeft: 8 }}>
                <SettingRowTitleSmall hint={t('chat.settings.code_execution.timeout_minutes.tip')}>
                  {t('chat.settings.code_execution.timeout_minutes.label')}
                </SettingRowTitleSmall>
                <EditableNumber
                  size="small"
                  min={1}
                  max={60}
                  step={1}
                  value={codeExecution.timeoutMinutes}
                  onChange={(value) => setCodeExecution({ timeoutMinutes: value ?? 1 })}
                  style={{ width: 80 }}
                />
              </SettingRow>
            </>
          )}
          <SettingDivider />
          <SettingRow>
            <SettingSwitch
              checked={codeEditor.enabled}
              onCheckedChange={(checked) => setCodeEditor({ enabled: checked })}
              label={t('chat.settings.code_editor.title')}
            />
          </SettingRow>
          {codeEditor.enabled && (
            <>
              <SettingDivider />
              <SettingRow style={{ paddingLeft: 8 }}>
                <SettingSwitch
                  checked={codeEditor.highlightActiveLine}
                  onCheckedChange={(checked) => setCodeEditor({ highlightActiveLine: checked })}
                  label={t('chat.settings.code_editor.highlight_active_line')}
                />
              </SettingRow>
              <SettingDivider />
              <SettingRow style={{ paddingLeft: 8 }}>
                <SettingSwitch
                  checked={codeEditor.foldGutter}
                  onCheckedChange={(checked) => setCodeEditor({ foldGutter: checked })}
                  label={t('chat.settings.code_editor.fold_gutter')}
                />
              </SettingRow>
              <SettingDivider />
              <SettingRow style={{ paddingLeft: 8 }}>
                <SettingSwitch
                  checked={codeEditor.autocompletion}
                  onCheckedChange={(checked) => setCodeEditor({ autocompletion: checked })}
                  label={t('chat.settings.code_editor.autocompletion')}
                />
              </SettingRow>
              <SettingDivider />
              <SettingRow style={{ paddingLeft: 8 }}>
                <SettingSwitch
                  checked={codeEditor.keymap}
                  onCheckedChange={(checked) => setCodeEditor({ keymap: checked })}
                  label={t('chat.settings.code_editor.keymap')}
                />
              </SettingRow>
            </>
          )}
          <SettingDivider />
          <SettingRow>
            <SettingSwitch
              checked={codeShowLineNumbers}
              onCheckedChange={setCodeShowLineNumbers}
              label={t('chat.settings.show_line_numbers')}
            />
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            <SettingSwitch
              checked={codeCollapsible}
              onCheckedChange={setCodeCollapsible}
              label={t('chat.settings.code_collapsible')}
            />
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            <SettingSwitch
              checked={codeWrappable}
              onCheckedChange={setCodeWrappable}
              label={t('chat.settings.code_wrappable')}
            />
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            <SettingSwitch
              checked={codeImageTools}
              onCheckedChange={setCodeImageTools}
              label={t('chat.settings.code_image_tools.label')}
              hint={t('chat.settings.code_image_tools.tip')}
            />
          </SettingRow>
        </SettingGroup>
      </CollapsibleSettingGroup>
      <SettingDivider className="my-0" />
      <CollapsibleSettingGroup title={t('settings.messages.input.title')} defaultExpanded={false}>
        <SettingGroup>
          {features?.showInputEstimatedTokens && (
            <>
              <SettingRow>
                <SettingSwitch
                  checked={showInputEstimatedTokens}
                  onCheckedChange={setShowInputEstimatedTokens}
                  label={t('settings.messages.input.show_estimated_tokens')}
                />
              </SettingRow>
              <SettingDivider />
            </>
          )}
          <SettingRow>
            <SettingSwitch
              checked={pasteLongTextAsFile}
              onCheckedChange={setPasteLongTextAsFile}
              label={t('settings.messages.input.paste_long_text_as_file')}
            />
          </SettingRow>
          {pasteLongTextAsFile && (
            <>
              <SettingDivider />
              <SettingRow>
                <SettingRowTitleSmall>{t('settings.messages.input.paste_long_text_threshold')}</SettingRowTitleSmall>
                <EditableNumber
                  size="small"
                  min={500}
                  max={10000}
                  step={100}
                  value={pasteLongTextThreshold}
                  onChange={(value) => setPasteLongTextThreshold(value ?? 500)}
                  style={{ width: 80 }}
                />
              </SettingRow>
            </>
          )}
          <SettingDivider />
          <SettingRow>
            <SettingSwitch
              checked={renderInputMessageAsMarkdown}
              onCheckedChange={setRenderInputMessageAsMarkdown}
              label={t('settings.messages.markdown_rendering_input_message')}
            />
          </SettingRow>
          <SettingDivider />
          {!(language || navigator.language).startsWith('en') && (
            <>
              <SettingRow>
                <SettingSwitch
                  checked={autoTranslateWithSpace}
                  onCheckedChange={setAutoTranslateWithSpace}
                  label={t('settings.input.auto_translate_with_space')}
                />
              </SettingRow>
              <SettingDivider />
            </>
          )}
          <SettingRow>
            <SettingSwitch
              checked={showTranslateConfirm}
              onCheckedChange={setShowTranslateConfirm}
              label={t('settings.input.show_translate_confirm')}
            />
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            <SettingSwitch
              checked={enableQuickPanelTriggers}
              onCheckedChange={setEnableQuickPanelTriggers}
              label={t('settings.messages.input.enable_quick_triggers')}
            />
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            <SettingSwitch
              checked={confirmDeleteMessage}
              onCheckedChange={setConfirmDeleteMessage}
              label={t('settings.messages.input.confirm_delete_message')}
            />
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            <SettingSwitch
              checked={confirmRegenerateMessage}
              onCheckedChange={setConfirmRegenerateMessage}
              label={t('settings.messages.input.confirm_regenerate_message')}
            />
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            <SettingRowTitleSmall>{t('settings.input.target_language.label')}</SettingRowTitleSmall>
            <Select value={targetLanguage} onValueChange={setTargetLanguage}>
              <SelectTrigger size="sm" className="w-45">
                <SelectValue placeholder={getLabel(null)} />
              </SelectTrigger>
              <SelectContent>
                {targetLanguageItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            <SettingRowTitleSmall>{t('settings.messages.input.send_shortcuts')}</SettingRowTitleSmall>
            <Select value={sendMessageShortcut} onValueChange={setSendMessageShortcut}>
              <SelectTrigger size="sm" className="w-45">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sendMessageShortcutItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>
        </SettingGroup>
      </CollapsibleSettingGroup>
    </>
  )
}

export default ChatPreferenceSections
