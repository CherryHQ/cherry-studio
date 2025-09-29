import { Button, DescriptionSwitch, HelpTooltip, RowFlex, Selector } from '@cherrystudio/ui'
import { useMultiplePreferences, usePreference } from '@data/hooks/usePreference'
import EditableNumber from '@renderer/components/EditableNumber'
import Scrollbar from '@renderer/components/Scrollbar'
import { DEFAULT_CONTEXTCOUNT, DEFAULT_MAX_TOKENS, DEFAULT_TEMPERATURE } from '@renderer/config/constant'
import { isOpenAIModel } from '@renderer/config/models'
import { UNKNOWN } from '@renderer/config/translate'
import { useCodeStyle } from '@renderer/context/CodeStyleProvider'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useProvider } from '@renderer/hooks/useProvider'
import useTranslate from '@renderer/hooks/useTranslate'
import { SettingDivider, SettingRow, SettingRowTitle } from '@renderer/pages/settings'
import AssistantSettingsPopup from '@renderer/pages/settings/AssistantSettings'
import { CollapsibleSettingGroup } from '@renderer/pages/settings/SettingGroup'
import { getDefaultModel } from '@renderer/services/AssistantService'
import type { Assistant, AssistantSettings, CodeStyleVarious, MathEngine } from '@renderer/types'
import { modalConfirm } from '@renderer/utils'
import { getSendMessageShortcutLabel } from '@renderer/utils/input'
import type { SendMessageShortcut } from '@shared/data/preference/preferenceTypes'
import { ThemeMode } from '@shared/data/preference/preferenceTypes'
import { Col, InputNumber, Row, Slider } from 'antd'
import { Settings2 } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import OpenAISettingsGroup from './components/OpenAISettingsGroup'
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

  const { assistant, updateAssistantSettings } = useAssistant(props.assistant.id)
  const { provider } = useProvider(assistant.model.provider)

  const { theme } = useTheme()
  const { themeNames } = useCodeStyle()

  const [temperature, setTemperature] = useState(assistant?.settings?.temperature ?? DEFAULT_TEMPERATURE)
  const [enableTemperature, setEnableTemperature] = useState(assistant?.settings?.enableTemperature ?? true)
  const [contextCount, setContextCount] = useState(assistant?.settings?.contextCount ?? DEFAULT_CONTEXTCOUNT)
  const [enableMaxTokens, setEnableMaxTokens] = useState(assistant?.settings?.enableMaxTokens ?? false)
  const [maxTokens, setMaxTokens] = useState(assistant?.settings?.maxTokens ?? 0)
  const [fontSizeValue, setFontSizeValue] = useState(fontSize)
  const [streamOutput, setStreamOutput] = useState(assistant?.settings?.streamOutput)
  const { translateLanguages } = useTranslate()

  const { t } = useTranslation()

  const onUpdateAssistantSettings = (settings: Partial<AssistantSettings>) => {
    updateAssistantSettings(settings)
  }

  const onTemperatureChange = (value) => {
    if (!isNaN(value as number)) {
      onUpdateAssistantSettings({ temperature: value })
    }
  }

  const onContextCountChange = (value) => {
    if (!isNaN(value as number)) {
      onUpdateAssistantSettings({ contextCount: value })
    }
  }

  const onMaxTokensChange = (value) => {
    if (!isNaN(value as number)) {
      onUpdateAssistantSettings({ maxTokens: value })
    }
  }

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

  useEffect(() => {
    setTemperature(assistant?.settings?.temperature ?? DEFAULT_TEMPERATURE)
    setEnableTemperature(assistant?.settings?.enableTemperature ?? true)
    setContextCount(assistant?.settings?.contextCount ?? DEFAULT_CONTEXTCOUNT)
    setEnableMaxTokens(assistant?.settings?.enableMaxTokens ?? false)
    setMaxTokens(assistant?.settings?.maxTokens ?? DEFAULT_MAX_TOKENS)
    setStreamOutput(assistant?.settings?.streamOutput ?? true)
  }, [assistant])

  const assistantContextCount = assistant?.settings?.contextCount || 20
  const maxContextCount = assistantContextCount > 20 ? assistantContextCount : 20

  const model = assistant.model || getDefaultModel()

  const isOpenAI = isOpenAIModel(model)

  return (
    <Container className="settings-tab">
      <CollapsibleSettingGroup
        title={t('assistants.settings.title')}
        defaultExpanded={true}
        extra={
          <RowFlex className="items-center gap-0.5">
            <Button
              variant="light"
              size="sm"
              isIconOnly
              onPress={() => AssistantSettingsPopup.show({ assistant, tab: 'model' })}>
              <Settings2 size={16} />
            </Button>
          </RowFlex>
        }>
        <SettingGroup style={{ marginTop: 5 }}>
          <Row align="middle">
            {/* <SettingRowTitleSmall>
              {t('chat.settings.temperature.label')}
              <HelpTooltip title={t('chat.settings.temperature.tip')} />
            </SettingRowTitleSmall> */}
            <DescriptionSwitch
              size="sm"
              className="ml-auto"
              isSelected={enableTemperature}
              onValueChange={(enabled) => {
                setEnableTemperature(enabled)
                onUpdateAssistantSettings({ enableTemperature: enabled })
              }}>
              <SettingRowTitleSmall>
                {t('chat.settings.temperature.label')}
                <HelpTooltip title={t('chat.settings.temperature.tip')} />
              </SettingRowTitleSmall>
            </DescriptionSwitch>
          </Row>
          {enableTemperature ? (
            <Row align="middle" gutter={10}>
              <Col span={23}>
                <Slider
                  min={0}
                  max={2}
                  onChange={setTemperature}
                  onChangeComplete={onTemperatureChange}
                  value={typeof temperature === 'number' ? temperature : 0}
                  step={0.1}
                />
              </Col>
            </Row>
          ) : (
            <SettingDivider />
          )}
          <Row align="middle">
            <SettingRowTitleSmall>
              {t('chat.settings.context_count.label')}
              <HelpTooltip title={t('chat.settings.context_count.tip')} />
            </SettingRowTitleSmall>
          </Row>
          <Row align="middle" gutter={10}>
            <Col span={23}>
              <Slider
                min={0}
                max={maxContextCount}
                onChange={setContextCount}
                onChangeComplete={onContextCountChange}
                value={typeof contextCount === 'number' ? contextCount : 0}
                step={1}
              />
            </Col>
          </Row>
          <SettingDivider />
          <SettingRow>
            <DescriptionSwitch
              size="sm"
              isSelected={streamOutput}
              onValueChange={(checked) => {
                setStreamOutput(checked)
                onUpdateAssistantSettings({ streamOutput: checked })
              }}>
              <SettingRowTitleSmall>{t('models.stream_output')}</SettingRowTitleSmall>
            </DescriptionSwitch>
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            <DescriptionSwitch
              size="sm"
              isSelected={enableMaxTokens}
              onValueChange={async (enabled) => {
                if (enabled) {
                  const confirmed = await modalConfirm({
                    title: t('chat.settings.max_tokens.confirm'),
                    content: t('chat.settings.max_tokens.confirm_content'),
                    okButtonProps: {
                      danger: true
                    }
                  })
                  if (!confirmed) return
                }
                setEnableMaxTokens(enabled)
                onUpdateAssistantSettings({ enableMaxTokens: enabled })
              }}>
              <SettingRowTitleSmall>
                {t('chat.settings.max_tokens.label')}
                <HelpTooltip title={t('chat.settings.max_tokens.tip')} />
              </SettingRowTitleSmall>
            </DescriptionSwitch>
          </SettingRow>
          {enableMaxTokens && (
            <Row align="middle" gutter={10} style={{ marginTop: 10 }}>
              <Col span={24}>
                <InputNumber
                  disabled={!enableMaxTokens}
                  min={0}
                  max={10000000}
                  step={100}
                  value={typeof maxTokens === 'number' ? maxTokens : 0}
                  changeOnBlur
                  onChange={(value) => value && setMaxTokens(value)}
                  onBlur={() => onMaxTokensChange(maxTokens)}
                  style={{ width: '100%' }}
                />
              </Col>
            </Row>
          )}
          <SettingDivider />
        </SettingGroup>
      </CollapsibleSettingGroup>
      {isOpenAI && (
        <OpenAISettingsGroup
          model={model}
          providerId={provider.id}
          SettingGroup={SettingGroup}
          SettingRowTitleSmall={SettingRowTitleSmall}
        />
      )}
      <CollapsibleSettingGroup title={t('settings.messages.title')} defaultExpanded={true}>
        <SettingGroup>
          <SettingRow>
            <DescriptionSwitch size="sm" isSelected={showPrompt} onValueChange={setShowPrompt}>
              <SettingRowTitleSmall>{t('settings.messages.prompt')}</SettingRowTitleSmall>
            </DescriptionSwitch>
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            {/* <SettingRowTitleSmall>{t('settings.messages.use_serif_font')}</SettingRowTitleSmall> */}
            <DescriptionSwitch
              size="sm"
              isSelected={messageFont === 'serif'}
              onValueChange={(checked) => setMessageFont(checked ? 'serif' : 'system')}>
              <SettingRowTitleSmall>{t('settings.messages.use_serif_font')}</SettingRowTitleSmall>
            </DescriptionSwitch>
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            {/* <SettingRowTitleSmall>
              {t('chat.settings.thought_auto_collapse.label')}
              <HelpTooltip title={t('chat.settings.thought_auto_collapse.tip')} />
            </SettingRowTitleSmall> */}
            <DescriptionSwitch isSelected={thoughtAutoCollapse} onValueChange={setThoughtAutoCollapse}>
              <SettingRowTitleSmall>
                {t('chat.settings.thought_auto_collapse.label')}
                <HelpTooltip title={t('chat.settings.thought_auto_collapse.tip')} />
              </SettingRowTitleSmall>
            </DescriptionSwitch>
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            <DescriptionSwitch isSelected={showMessageOutline} onValueChange={setShowMessageOutline}>
              <SettingRowTitleSmall>{t('settings.messages.show_message_outline')}</SettingRowTitleSmall>
            </DescriptionSwitch>
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            {/* <SettingRowTitleSmall>{t('message.message.style.label')}</SettingRowTitleSmall> */}
            <Selector
              size="sm"
              label={t('message.message.style.label')}
              selectedKeys={[messageStyle]}
              onSelectionChange={(value) => setMessageStyle(value[0] as 'plain' | 'bubble')}
              items={[
                { value: 'plain', label: t('message.message.style.plain') },
                { value: 'bubble', label: t('message.message.style.bubble') }
              ]}
            />
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            {/* <SettingRowTitleSmall>{t('message.message.multi_model_style.label')}</SettingRowTitleSmall> */}
            <Selector
              size="sm"
              label={t('message.message.multi_model_style.label')}
              selectedKeys={[multiModelMessageStyle]}
              onSelectionChange={(value) => setMultiModelMessageStyle(value[0])}
              items={[
                { value: 'fold', label: t('message.message.multi_model_style.fold.label') },
                { value: 'vertical', label: t('message.message.multi_model_style.vertical') },
                { value: 'horizontal', label: t('message.message.multi_model_style.horizontal') },
                { value: 'grid', label: t('message.message.multi_model_style.grid') }
              ]}
            />
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            {/* <SettingRowTitleSmall>{t('settings.messages.navigation.label')}</SettingRowTitleSmall> */}
            <Selector
              size="sm"
              label={t('settings.messages.navigation.label')}
              selectedKeys={[messageNavigation]}
              onSelectionChange={(value) => setMessageNavigation(value[0] as 'none' | 'buttons' | 'anchor')}
              items={[
                { value: 'none', label: t('settings.messages.navigation.none') },
                { value: 'buttons', label: t('settings.messages.navigation.buttons') },
                { value: 'anchor', label: t('settings.messages.navigation.anchor') }
              ]}
            />
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
            {/* <SettingRowTitleSmall>{t('settings.math.engine.label')}</SettingRowTitleSmall> */}
            <Selector
              size="sm"
              label={t('settings.math.engine.label')}
              selectedKeys={[mathEngine]}
              onSelectionChange={(value) => setMathEngine(value[0] as MathEngine)}
              items={[
                { value: 'KaTeX', label: 'KaTeX' },
                { value: 'MathJax', label: 'MathJax' },
                { value: 'none', label: t('settings.math.engine.none') }
              ]}
            />
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            {/* <SettingRowTitleSmall>
              {t('settings.math.single_dollar.label')}
              <HelpTooltip title={t('settings.math.single_dollar.tip')} />
            </SettingRowTitleSmall> */}
            <DescriptionSwitch size="sm" isSelected={mathEnableSingleDollar} onValueChange={setMathEnableSingleDollar}>
              <SettingRowTitleSmall>
                {t('settings.math.single_dollar.label')}
                <HelpTooltip title={t('settings.math.single_dollar.tip')} />
              </SettingRowTitleSmall>
            </DescriptionSwitch>
          </SettingRow>
          <SettingDivider />
        </SettingGroup>
      </CollapsibleSettingGroup>
      <CollapsibleSettingGroup title={t('chat.settings.code.title')} defaultExpanded={false}>
        <SettingGroup>
          <SettingRow>
            {/* <SettingRowTitleSmall>{t('message.message.code_style')}</SettingRowTitleSmall> */}
            <Selector
              size="sm"
              label={t('message.message.code_style')}
              selectedKeys={[codeStyle]}
              onSelectionChange={(value) => onCodeStyleChange(value[0] as CodeStyleVarious)}
              items={themeNames.map((theme) => ({
                value: theme,
                label: theme
              }))}
            />
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            {/* <SettingRowTitleSmall>
              {t('chat.settings.code_fancy_block.label')}
              <HelpTooltip title={t('chat.settings.code_fancy_block.tip')} />
            </SettingRowTitleSmall> */}
            <DescriptionSwitch size="sm" isSelected={codeFancyBlock} onValueChange={setCodeFancyBlock}>
              <SettingRowTitleSmall>
                {t('chat.settings.code_fancy_block.label')}
                <HelpTooltip title={t('chat.settings.code_fancy_block.tip')} />
              </SettingRowTitleSmall>
            </DescriptionSwitch>
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            {/* <SettingRowTitleSmall>
              {t('chat.settings.code_execution.title')}
              <HelpTooltip title={t('chat.settings.code_execution.tip')} />
            </SettingRowTitleSmall> */}
            <DescriptionSwitch
              size="sm"
              isSelected={codeExecution.enabled}
              onValueChange={(checked) => setCodeExecution({ enabled: checked })}>
              <SettingRowTitleSmall>
                {t('chat.settings.code_execution.title')}
                <HelpTooltip title={t('chat.settings.code_execution.tip')} />
              </SettingRowTitleSmall>
            </DescriptionSwitch>
          </SettingRow>
          {codeExecution.enabled && (
            <>
              <SettingDivider />
              <SettingRow style={{ paddingLeft: 8 }}>
                <SettingRowTitleSmall>
                  {t('chat.settings.code_execution.timeout_minutes.label')}
                  <HelpTooltip title={t('chat.settings.code_execution.timeout_minutes.tip')} />
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
            {/* <SettingRowTitleSmall>{t('chat.settings.code_editor.title')}</SettingRowTitleSmall> */}
            <DescriptionSwitch
              size="sm"
              isSelected={codeEditor.enabled}
              onValueChange={(checked) => setCodeEditor({ enabled: checked })}>
              <SettingRowTitleSmall>{t('chat.settings.code_editor.title')}</SettingRowTitleSmall>
            </DescriptionSwitch>
          </SettingRow>
          {codeEditor.enabled && (
            <>
              <SettingDivider />
              <SettingRow style={{ paddingLeft: 8 }}>
                {/* <SettingRowTitleSmall>
                  {t('chat.settings.code_editor.highlight_active_line')}
                  <HelpTooltip title={t('chat.settings.code_editor.highlight_active_line.tip')} />
                </SettingRowTitleSmall> */}
                <DescriptionSwitch
                  size="sm"
                  isSelected={codeEditor.highlightActiveLine}
                  onValueChange={(checked) => setCodeEditor({ highlightActiveLine: checked })}>
                  <SettingRowTitleSmall>
                    {t('chat.settings.code_editor.highlight_active_line')}
                    <HelpTooltip title={t('chat.settings.code_editor.highlight_active_line.tip')} />
                  </SettingRowTitleSmall>
                </DescriptionSwitch>
              </SettingRow>
              <SettingDivider />
              <SettingRow style={{ paddingLeft: 8 }}>
                {/* <SettingRowTitleSmall>{t('chat.settings.code_editor.fold_gutter')}</SettingRowTitleSmall> */}
                <DescriptionSwitch
                  size="sm"
                  isSelected={codeEditor.foldGutter}
                  onValueChange={(checked) => setCodeEditor({ foldGutter: checked })}>
                  <SettingRowTitleSmall>{t('chat.settings.code_editor.fold_gutter')}</SettingRowTitleSmall>
                </DescriptionSwitch>
              </SettingRow>
              <SettingDivider />
              <SettingRow style={{ paddingLeft: 8 }}>
                {/* <SettingRowTitleSmall>{t('chat.settings.code_editor.autocompletion')}</SettingRowTitleSmall> */}
                <DescriptionSwitch
                  size="sm"
                  isSelected={codeEditor.autocompletion}
                  onValueChange={(checked) => setCodeEditor({ autocompletion: checked })}>
                  <SettingRowTitleSmall>{t('chat.settings.code_editor.autocompletion')}</SettingRowTitleSmall>
                </DescriptionSwitch>
              </SettingRow>
              <SettingDivider />
              <SettingRow style={{ paddingLeft: 8 }}>
                {/* <SettingRowTitleSmall>{t('chat.settings.code_editor.keymap')}</SettingRowTitleSmall> */}
                <DescriptionSwitch
                  size="sm"
                  isSelected={codeEditor.keymap}
                  onValueChange={(checked) => setCodeEditor({ keymap: checked })}>
                  <SettingRowTitleSmall>{t('chat.settings.code_editor.keymap')}</SettingRowTitleSmall>
                </DescriptionSwitch>
              </SettingRow>
            </>
          )}
          <SettingDivider />
          <SettingRow>
            <DescriptionSwitch size="sm" isSelected={codeShowLineNumbers} onValueChange={setCodeShowLineNumbers}>
              <SettingRowTitleSmall>{t('chat.settings.show_line_numbers')}</SettingRowTitleSmall>
            </DescriptionSwitch>
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            <DescriptionSwitch size="sm" isSelected={codeCollapsible} onValueChange={setCodeCollapsible}>
              <SettingRowTitleSmall>{t('chat.settings.code_collapsible')}</SettingRowTitleSmall>
            </DescriptionSwitch>
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            <DescriptionSwitch size="sm" isSelected={codeWrappable} onValueChange={setCodeWrappable}>
              <SettingRowTitleSmall>{t('chat.settings.code_wrappable')}</SettingRowTitleSmall>
            </DescriptionSwitch>
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            <DescriptionSwitch size="sm" isSelected={codeImageTools} onValueChange={setCodeImageTools}>
              <SettingRowTitleSmall>
                {t('chat.settings.code_image_tools.label')}
                <HelpTooltip title={t('chat.settings.code_image_tools.tip')} />
              </SettingRowTitleSmall>
            </DescriptionSwitch>
          </SettingRow>
        </SettingGroup>
        <SettingDivider />
      </CollapsibleSettingGroup>
      <CollapsibleSettingGroup title={t('settings.messages.input.title')} defaultExpanded={false}>
        <SettingGroup>
          <SettingRow>
            <DescriptionSwitch
              size="sm"
              isSelected={showInputEstimatedTokens}
              onValueChange={setShowInputEstimatedTokens}>
              <SettingRowTitleSmall>{t('settings.messages.input.show_estimated_tokens')}</SettingRowTitleSmall>
            </DescriptionSwitch>
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            <DescriptionSwitch size="sm" isSelected={pasteLongTextAsFile} onValueChange={setPasteLongTextAsFile}>
              <SettingRowTitleSmall>{t('settings.messages.input.paste_long_text_as_file')}</SettingRowTitleSmall>
            </DescriptionSwitch>
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
              size="sm"
              isSelected={renderInputMessageAsMarkdown}
              onValueChange={setRenderInputMessageAsMarkdown}>
              <SettingRowTitleSmall>{t('settings.messages.markdown_rendering_input_message')}</SettingRowTitleSmall>
            </DescriptionSwitch>
          </SettingRow>
          <SettingDivider />
          {!(language || navigator.language).startsWith('en') && (
            <>
              <SettingRow>
                <DescriptionSwitch
                  size="sm"
                  isSelected={autoTranslateWithSpace}
                  onValueChange={setAutoTranslateWithSpace}>
                  <SettingRowTitleSmall>{t('settings.input.auto_translate_with_space')}</SettingRowTitleSmall>
                </DescriptionSwitch>
              </SettingRow>
              <SettingDivider />
            </>
          )}
          <SettingRow>
            <DescriptionSwitch size="sm" isSelected={showTranslateConfirm} onValueChange={setShowTranslateConfirm}>
              <SettingRowTitleSmall>{t('settings.input.show_translate_confirm')}</SettingRowTitleSmall>
            </DescriptionSwitch>
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            <DescriptionSwitch
              size="sm"
              isSelected={enableQuickPanelTriggers}
              onValueChange={setEnableQuickPanelTriggers}>
              <SettingRowTitleSmall>{t('settings.messages.input.enable_quick_triggers')}</SettingRowTitleSmall>
            </DescriptionSwitch>
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            <DescriptionSwitch size="sm" isSelected={confirmDeleteMessage} onValueChange={setConfirmDeleteMessage}>
              <SettingRowTitleSmall>{t('settings.messages.input.confirm_delete_message')}</SettingRowTitleSmall>
            </DescriptionSwitch>
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            <DescriptionSwitch
              size="sm"
              isSelected={confirmRegenerateMessage}
              onValueChange={setConfirmRegenerateMessage}>
              <SettingRowTitleSmall>{t('settings.messages.input.confirm_regenerate_message')}</SettingRowTitleSmall>
            </DescriptionSwitch>
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            {/* <SettingRowTitleSmall>{t('settings.input.target_language.label')}</SettingRowTitleSmall> */}
            <Selector
              size="sm"
              label={t('settings.input.target_language.label')}
              selectedKeys={[targetLanguage]}
              onSelectionChange={(value) => setTargetLanguage(value[0])}
              placeholder={UNKNOWN.emoji + ' ' + UNKNOWN.label()}
              items={translateLanguages.map((item) => {
                return { value: item.langCode, label: item.emoji + ' ' + item.label() }
              })}
            />
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            {/* <SettingRowTitleSmall>{}</SettingRowTitleSmall> */}
            <Selector
              size="sm"
              label={t('settings.messages.input.send_shortcuts')}
              selectedKeys={[sendMessageShortcut]}
              onSelectionChange={(value) => setSendMessageShortcut(value[0] as SendMessageShortcut)}
              items={[
                { value: 'Enter', label: getSendMessageShortcutLabel('Enter') },
                { value: 'Ctrl+Enter', label: getSendMessageShortcutLabel('Ctrl+Enter') },
                { value: 'Alt+Enter', label: getSendMessageShortcutLabel('Alt+Enter') },
                { value: 'Command+Enter', label: getSendMessageShortcutLabel('Command+Enter') },
                { value: 'Shift+Enter', label: getSendMessageShortcutLabel('Shift+Enter') }
              ]}
            />
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
