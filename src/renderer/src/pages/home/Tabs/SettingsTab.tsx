import {
  DescriptionSwitch,
  HelpTooltip,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch
} from '@cherrystudio/ui'
import { useMultiplePreferences, usePreference } from '@data/hooks/usePreference'
import EditableNumber from '@renderer/components/EditableNumber'
import Scrollbar from '@renderer/components/Scrollbar'
import { isOpenAIModel, isSupportVerbosityModel } from '@renderer/config/models'
import { UNKNOWN } from '@renderer/config/translate'
import { useCodeStyle } from '@renderer/context/CodeStyleProvider'
import { useTheme } from '@renderer/context/ThemeProvider'
import { cacheService } from '@renderer/data/CacheService'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useProvider } from '@renderer/hooks/useProvider'
import useTranslate from '@renderer/hooks/useTranslate'
import { SettingDivider, SettingRow, SettingRowTitle } from '@renderer/pages/settings'
import { CollapsibleSettingGroup } from '@renderer/pages/settings/SettingGroup'
import { getDefaultModel } from '@renderer/services/AssistantService'
import type { Assistant, CodeStyleVarious, MathEngine } from '@renderer/types'
import { isGroqSystemProvider } from '@renderer/types'
import { getSendMessageShortcutLabel } from '@renderer/utils/input'
import {
  isOpenAICompatibleProvider,
  isSupportServiceTierProvider,
  isSupportVerbosityProvider
} from '@renderer/utils/provider'
import type { SendMessageShortcut } from '@shared/data/preference/preferenceTypes'
import { ThemeMode } from '@shared/data/preference/preferenceTypes'
import { Col, Row, Slider } from 'antd'
import type { FC } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import GroqSettingsGroup from './components/GroqSettingsGroup'
import OpenAISettingsGroup from './components/OpenAISettingsGroup'

// Type definition for select items
type SelectorItem<T extends string = string> = {
  value: T
  label: string
}

interface Props {
  assistant: Assistant
}

const SettingsTab: FC<Props> = (props) => {
  const [messageStyle, setMessageStyle] = usePreference('chat.message.style')
  const [fontSize, setFontSize] = usePreference('chat.message.font_size')
  const [language] = usePreference('app.language')
  const [targetLanguage, setTargetLanguage] = usePreference('feature.translate.target_language')
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

  const { assistant } = useAssistant(props.assistant.id)
  const { provider } = useProvider(assistant.model.provider)

  const { theme } = useTheme()
  const { themeNames } = useCodeStyle()

  // FIXME: We should use useMemo to calculate these states instead of using useEffect to sync
  const [fontSizeValue, setFontSizeValue] = useState(fontSize)
  const { translateLanguages } = useTranslate()

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
    () => themeNames.map((theme) => ({ value: theme, label: theme })),
    [themeNames]
  )

  const targetLanguageItems = useMemo<SelectorItem<string>[]>(
    () => translateLanguages.map((item) => ({ value: item.langCode, label: item.emoji + ' ' + item.label() })),
    [translateLanguages]
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
      action({ [field]: value })
    },
    [theme, codeEditor.enabled, setCodeEditor, setCodeViewer]
  )

  const model = assistant.model || getDefaultModel()

  const showOpenAiSettings =
    isOpenAICompatibleProvider(provider) ||
    isOpenAIModel(model) ||
    isSupportServiceTierProvider(provider) ||
    (isSupportVerbosityModel(model) && isSupportVerbosityProvider(provider))

  const activeTopicOrSession = cacheService.get('chat.active_view')
  const isTopicSettings = activeTopicOrSession === 'topic'

  return (
    <Container className="settings-tab">
      {isTopicSettings && (
        <>
          {showOpenAiSettings && (
            <OpenAISettingsGroup
              model={model}
              providerId={provider.id}
              SettingGroup={SettingGroup}
              SettingRowTitleSmall={SettingRowTitleSmall}
            />
          )}
          {isGroqSystemProvider(provider) && (
            <GroqSettingsGroup SettingGroup={SettingGroup} SettingRowTitleSmall={SettingRowTitleSmall} />
          )}
        </>
      )}
      <CollapsibleSettingGroup title={t('settings.messages.title')} defaultExpanded={true}>
        <SettingGroup>
          {isTopicSettings && (
            <>
              <SettingRow>
                <DescriptionSwitch
                  checked={showPrompt}
                  onCheckedChange={setShowPrompt}
                  label={t('settings.messages.prompt')}
                />
              </SettingRow>
              <SettingDivider />
            </>
          )}
          <SettingRow>
            <DescriptionSwitch
              checked={messageFont === 'serif'}
              onCheckedChange={(checked) => setMessageFont(checked ? 'serif' : 'system')}
              label={t('settings.messages.use_serif_font')}
            />
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            <DescriptionSwitch
              checked={thoughtAutoCollapse}
              onCheckedChange={setThoughtAutoCollapse}
              label={t('chat.settings.thought_auto_collapse.label')}
              description={t('chat.settings.thought_auto_collapse.tip')}
            />
          </SettingRow>
          <SettingDivider />
          {isTopicSettings && (
            <>
              <SettingRow>
                <SettingRowTitleSmall>{t('settings.messages.show_message_outline')}</SettingRowTitleSmall>
                <Switch
                  size="sm"
                  checked={showMessageOutline}
                  onCheckedChange={(checked) => setShowMessageOutline(checked)}
                />
              </SettingRow>
              <SettingDivider />
            </>
          )}
          <SettingRow>
            <SettingRowTitleSmall>{t('message.message.style.label')}</SettingRowTitleSmall>
            <Select value={messageStyle} onValueChange={setMessageStyle}>
              <SelectTrigger size="sm" className="w-[180px]">
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
          {isTopicSettings && (
            <>
              <SettingRow>
                <SettingRowTitleSmall>{t('message.message.multi_model_style.label')}</SettingRowTitleSmall>
                <Select value={multiModelMessageStyle} onValueChange={setMultiModelMessageStyle}>
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
              <SelectTrigger size="sm" className="w-[180px]">
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
          <Row align="middle" gutter={10}>
            <Col span={24}>
              <Slider
                value={fontSizeValue}
                onChange={(value) => setFontSizeValue(value)}
                onChangeComplete={(value) => setFontSize(value)}
                min={12}
                max={22}
                step={1}
                marks={{
                  12: <span style={{ fontSize: '12px' }}>A</span>,
                  14: <span style={{ fontSize: '14px' }}>{t('common.default')}</span>,
                  22: <span style={{ fontSize: '18px' }}>A</span>
                }}
              />
            </Col>
          </Row>
          <SettingDivider />
        </SettingGroup>
      </CollapsibleSettingGroup>
      <CollapsibleSettingGroup title={t('settings.math.title')} defaultExpanded={false}>
        <SettingGroup>
          <SettingRow>
            <SettingRowTitleSmall>{t('settings.math.engine.label')}</SettingRowTitleSmall>
            <Select value={mathEngine} onValueChange={setMathEngine}>
              <SelectTrigger size="sm" className="w-[180px]">
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
            <DescriptionSwitch
              checked={mathEnableSingleDollar}
              onCheckedChange={setMathEnableSingleDollar}
              label={t('settings.math.single_dollar.label')}
              description={t('settings.math.single_dollar.tip')}
            />
          </SettingRow>
          <SettingDivider />
        </SettingGroup>
      </CollapsibleSettingGroup>
      <CollapsibleSettingGroup title={t('chat.settings.code.title')} defaultExpanded={false}>
        <SettingGroup>
          <SettingRow>
            <SettingRowTitleSmall>{t('message.message.code_style')}</SettingRowTitleSmall>
            <Select value={codeStyle} onValueChange={onCodeStyleChange}>
              <SelectTrigger size="sm" className="w-[180px]">
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
            <DescriptionSwitch
              checked={codeFancyBlock}
              onCheckedChange={setCodeFancyBlock}
              label={t('chat.settings.code_fancy_block.label')}
              description={t('chat.settings.code_fancy_block.tip')}
            />
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            <DescriptionSwitch
              checked={codeExecution.enabled}
              onCheckedChange={(checked) => setCodeExecution({ enabled: checked })}
              label={t('chat.settings.code_execution.title')}
              description={t('chat.settings.code_execution.tip')}
            />
          </SettingRow>
          {codeExecution.enabled && (
            <>
              <SettingDivider />
              <SettingRow style={{ paddingLeft: 8 }}>
                <SettingRowTitleSmall>
                  {t('chat.settings.code_execution.timeout_minutes.label')}
                  <HelpTooltip content={t('chat.settings.code_execution.timeout_minutes.tip')} />
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
            <DescriptionSwitch
              checked={codeEditor.enabled}
              onCheckedChange={(checked) => setCodeEditor({ enabled: checked })}
              label={t('chat.settings.code_editor.title')}
            />
          </SettingRow>
          {codeEditor.enabled && (
            <>
              <SettingDivider />
              <SettingRow style={{ paddingLeft: 8 }}>
                <DescriptionSwitch
                  checked={codeEditor.highlightActiveLine}
                  onCheckedChange={(checked) => setCodeEditor({ highlightActiveLine: checked })}
                  label={t('chat.settings.code_editor.highlight_active_line')}
                />
              </SettingRow>
              <SettingDivider />
              <SettingRow style={{ paddingLeft: 8 }}>
                <DescriptionSwitch
                  checked={codeEditor.foldGutter}
                  onCheckedChange={(checked) => setCodeEditor({ foldGutter: checked })}
                  label={t('chat.settings.code_editor.fold_gutter')}
                />
              </SettingRow>
              <SettingDivider />
              <SettingRow style={{ paddingLeft: 8 }}>
                <DescriptionSwitch
                  checked={codeEditor.autocompletion}
                  onCheckedChange={(checked) => setCodeEditor({ autocompletion: checked })}
                  label={t('chat.settings.code_editor.autocompletion')}
                />
              </SettingRow>
              <SettingDivider />
              <SettingRow style={{ paddingLeft: 8 }}>
                <DescriptionSwitch
                  checked={codeEditor.keymap}
                  onCheckedChange={(checked) => setCodeEditor({ keymap: checked })}
                  label={t('chat.settings.code_editor.keymap')}
                />
              </SettingRow>
            </>
          )}
          <SettingDivider />
          <SettingRow>
            <DescriptionSwitch
              checked={codeShowLineNumbers}
              onCheckedChange={setCodeShowLineNumbers}
              label={t('chat.settings.show_line_numbers')}
            />
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            <DescriptionSwitch
              checked={codeCollapsible}
              onCheckedChange={setCodeCollapsible}
              label={t('chat.settings.code_collapsible')}
            />
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            <DescriptionSwitch
              checked={codeWrappable}
              onCheckedChange={setCodeWrappable}
              label={t('chat.settings.code_wrappable')}
            />
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            <DescriptionSwitch
              checked={codeImageTools}
              onCheckedChange={setCodeImageTools}
              label={t('chat.settings.code_image_tools.label')}
              description={t('chat.settings.code_image_tools.tip')}
            />
          </SettingRow>
        </SettingGroup>
        <SettingDivider />
      </CollapsibleSettingGroup>
      <CollapsibleSettingGroup title={t('settings.messages.input.title')} defaultExpanded={false}>
        <SettingGroup>
          {isTopicSettings && (
            <>
              <SettingRow>
                <SettingRowTitleSmall>{t('settings.messages.input.show_estimated_tokens')}</SettingRowTitleSmall>
                <Switch size="sm" checked={showInputEstimatedTokens} onCheckedChange={setShowInputEstimatedTokens} />
              </SettingRow>
              <SettingDivider />
            </>
          )}
          <SettingRow>
            <DescriptionSwitch
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
            <DescriptionSwitch
              checked={renderInputMessageAsMarkdown}
              onCheckedChange={setRenderInputMessageAsMarkdown}
              label={t('settings.messages.markdown_rendering_input_message')}
            />
          </SettingRow>
          <SettingDivider />
          {!(language || navigator.language).startsWith('en') && (
            <>
              <SettingRow>
                <DescriptionSwitch
                  checked={autoTranslateWithSpace}
                  onCheckedChange={setAutoTranslateWithSpace}
                  label={t('settings.input.auto_translate_with_space')}
                />
              </SettingRow>
              <SettingDivider />
            </>
          )}
          <SettingRow>
            <DescriptionSwitch
              checked={showTranslateConfirm}
              onCheckedChange={setShowTranslateConfirm}
              label={t('settings.input.show_translate_confirm')}
            />
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            <DescriptionSwitch
              checked={enableQuickPanelTriggers}
              onCheckedChange={setEnableQuickPanelTriggers}
              label={t('settings.messages.input.enable_quick_triggers')}
            />
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            <DescriptionSwitch
              checked={confirmDeleteMessage}
              onCheckedChange={setConfirmDeleteMessage}
              label={t('settings.messages.input.confirm_delete_message')}
            />
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            <DescriptionSwitch
              checked={confirmRegenerateMessage}
              onCheckedChange={setConfirmRegenerateMessage}
              label={t('settings.messages.input.confirm_regenerate_message')}
            />
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            <SettingRowTitleSmall>{t('settings.input.target_language.label')}</SettingRowTitleSmall>
            <Select value={targetLanguage} onValueChange={setTargetLanguage}>
              <SelectTrigger size="sm" className="w-[180px]">
                <SelectValue placeholder={UNKNOWN.emoji + ' ' + UNKNOWN.label()} />
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
              <SelectTrigger size="sm" className="w-[180px]">
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
    </Container>
  )
}

const Container = styled(Scrollbar)`
  display: flex;
  flex: 1;
  flex-direction: column;
  padding: 0 8px;
  padding-right: 0;
  padding-top: 2px;
  padding-bottom: 10px;
  margin-top: 3px;
`

const SettingRowTitleSmall = styled(SettingRowTitle)`
  font-size: 13px;
  gap: 4px;
`

const SettingGroup = styled.div<{ theme?: ThemeMode }>`
  padding: 0 5px;
  width: 100%;
  margin-top: 0;
  border-radius: 8px;
  margin-bottom: 10px;
`

export default SettingsTab
