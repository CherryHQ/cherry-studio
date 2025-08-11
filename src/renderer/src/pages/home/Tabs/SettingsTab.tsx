import EditableNumber from '@renderer/components/EditableNumber'
import { HStack } from '@renderer/components/Layout'
import Scrollbar from '@renderer/components/Scrollbar'
import Selector from '@renderer/components/Selector'
import { DEFAULT_CONTEXTCOUNT, DEFAULT_MAX_TOKENS, DEFAULT_TEMPERATURE } from '@renderer/config/constant'
import { isOpenAIModel } from '@renderer/config/models'
import { UNKNOWN } from '@renderer/config/translate'
import { useCodeStyle } from '@renderer/context/CodeStyleProvider'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useProvider } from '@renderer/hooks/useProvider'
import { useSettings } from '@renderer/hooks/useSettings'
import useTranslate from '@renderer/hooks/useTranslate'
import { SettingDivider, SettingRow, SettingRowTitle } from '@renderer/pages/settings'
import AssistantSettingsPopup from '@renderer/pages/settings/AssistantSettings'
import { CollapsibleSettingGroup } from '@renderer/pages/settings/SettingGroup'
import { getDefaultModel } from '@renderer/services/AssistantService'
import { useAppDispatch } from '@renderer/store'
import {
  SendMessageShortcut,
  setAutoTranslateWithSpace,
  setCodeCollapsible,
  setCodeEditor,
  setCodeExecution,
  setCodeImageTools,
  setCodeShowLineNumbers,
  setCodeViewer,
  setCodeWrappable,
  setEnableBackspaceDeleteModel,
  setEnableQuickPanelTriggers,
  setFontSize,
  setMathEngine,
  setMessageFont,
  setMessageNavigation,
  setMessageStyle,
  setMultiModelMessageStyle,
  setPasteLongTextAsFile,
  setPasteLongTextThreshold,
  setRenderInputMessageAsMarkdown,
  setShowInputEstimatedTokens,
  setShowPrompt,
  setShowTranslateConfirm,
  setThoughtAutoCollapse
} from '@renderer/store/settings'
import { Assistant, AssistantSettings, CodeStyleVarious, MathEngine, ThemeMode } from '@renderer/types'
import { modalConfirm } from '@renderer/utils'
import { getSendMessageShortcutLabel } from '@renderer/utils/input'
import { Button, Col, InputNumber, Row, Slider, Switch, Tooltip } from 'antd'
import { CircleHelp, Settings2 } from 'lucide-react'
import { FC, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import OpenAISettingsGroup from './components/OpenAISettingsGroup'

interface Props {
  assistant: Assistant
}

const SettingsTab: FC<Props> = (props) => {
  const { assistant, updateAssistantSettings } = useAssistant(props.assistant.id)
  const { provider } = useProvider(assistant.model.provider)

  const { messageStyle, fontSize, language } = useSettings()
  const { theme } = useTheme()
  const { themeNames } = useCodeStyle()

  const [temperature, setTemperature] = useState(assistant?.settings?.temperature ?? DEFAULT_TEMPERATURE)
  const [enableTemperature, setEnableTemperature] = useState(assistant?.settings?.enableTemperature ?? true)
  const [contextCount, setContextCount] = useState(assistant?.settings?.contextCount ?? DEFAULT_CONTEXTCOUNT)
  const [enableMaxTokens, setEnableMaxTokens] = useState(assistant?.settings?.enableMaxTokens ?? false)
  const [maxTokens, setMaxTokens] = useState(assistant?.settings?.maxTokens ?? 0)
  const [fontSizeValue, setFontSizeValue] = useState(fontSize)
  const [streamOutput, setStreamOutput] = useState(assistant?.settings?.streamOutput ?? true)
  const { translateLanguages } = useTranslate()

  const { t } = useTranslation()

  const dispatch = useAppDispatch()

  const {
    showPrompt,
    messageFont,
    showInputEstimatedTokens,
    sendMessageShortcut,
    setSendMessageShortcut,
    targetLanguage,
    setTargetLanguage,
    pasteLongTextAsFile,
    renderInputMessageAsMarkdown,
    codeShowLineNumbers,
    codeCollapsible,
    codeWrappable,
    codeEditor,
    codeViewer,
    codeImageTools,
    codeExecution,
    mathEngine,
    autoTranslateWithSpace,
    pasteLongTextThreshold,
    multiModelMessageStyle,
    thoughtAutoCollapse,
    messageNavigation,
    enableQuickPanelTriggers,
    enableBackspaceDeleteModel,
    showTranslateConfirm
  } = useSettings()

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
      dispatch(action({ [field]: value }))
    },
    [dispatch, theme, codeEditor.enabled]
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
          <HStack alignItems="center" gap={2}>
            <Button
              type="text"
              size="small"
              icon={<Settings2 size={16} />}
              onClick={() => AssistantSettingsPopup.show({ assistant, tab: 'model' })}
            />
          </HStack>
        }>
        <SettingGroup style={{ marginTop: 5 }}>
          <Row align="middle">
            <SettingRowTitleSmall>{t('chat.settings.temperature.label')}</SettingRowTitleSmall>
            <Tooltip title={t('chat.settings.temperature.tip')}>
              <CircleHelp size={14} style={{ marginLeft: 4 }} color="var(--color-text-2)" />
            </Tooltip>
            <Switch
              size="small"
              style={{ marginLeft: 'auto' }}
              checked={enableTemperature}
              onChange={(enabled) => {
                setEnableTemperature(enabled)
                onUpdateAssistantSettings({ enableTemperature: enabled })
              }}
            />
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
            <SettingRowTitleSmall>{t('chat.settings.context_count.label')}</SettingRowTitleSmall>
            <Tooltip title={t('chat.settings.context_count.tip')}>
              <CircleHelp size={14} style={{ marginLeft: 4 }} color="var(--color-text-2)" />
            </Tooltip>
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
            <SettingRowTitleSmall>{t('models.stream_output')}</SettingRowTitleSmall>
            <Switch
              size="small"
              checked={streamOutput}
              onChange={(checked) => {
                setStreamOutput(checked)
                onUpdateAssistantSettings({ streamOutput: checked })
              }}
            />
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            <Row align="middle">
              <SettingRowTitleSmall>{t('chat.settings.max_tokens.label')}</SettingRowTitleSmall>
              <Tooltip title={t('chat.settings.max_tokens.tip')}>
                <CircleHelp size={14} style={{ marginLeft: 4 }} color="var(--color-text-2)" />
              </Tooltip>
            </Row>
            <Switch
              size="small"
              checked={enableMaxTokens}
              onChange={async (enabled) => {
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
              }}
            />
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
            <SettingRowTitleSmall>{t('settings.messages.prompt')}</SettingRowTitleSmall>
            <Switch size="small" checked={showPrompt} onChange={(checked) => dispatch(setShowPrompt(checked))} />
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            <SettingRowTitleSmall>{t('settings.messages.use_serif_font')}</SettingRowTitleSmall>
            <Switch
              size="small"
              checked={messageFont === 'serif'}
              onChange={(checked) => dispatch(setMessageFont(checked ? 'serif' : 'system'))}
            />
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            <SettingRowTitleSmall>
              {t('chat.settings.thought_auto_collapse.label')}
              <Tooltip title={t('chat.settings.thought_auto_collapse.tip')}>
                <CircleHelp size={14} style={{ marginLeft: 4 }} color="var(--color-text-2)" />
              </Tooltip>
            </SettingRowTitleSmall>
            <Switch
              size="small"
              checked={thoughtAutoCollapse}
              onChange={(checked) => dispatch(setThoughtAutoCollapse(checked))}
            />
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            <SettingRowTitleSmall>{t('message.message.style.label')}</SettingRowTitleSmall>
            <Selector
              value={messageStyle}
              onChange={(value) => dispatch(setMessageStyle(value as 'plain' | 'bubble'))}
              options={[
                { value: 'plain', label: t('message.message.style.plain') },
                { value: 'bubble', label: t('message.message.style.bubble') }
              ]}
            />
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            <SettingRowTitleSmall>{t('message.message.multi_model_style.label')}</SettingRowTitleSmall>
            <Selector
              value={multiModelMessageStyle}
              onChange={(value) => dispatch(setMultiModelMessageStyle(value))}
              options={[
                { value: 'fold', label: t('message.message.multi_model_style.fold.label') },
                { value: 'vertical', label: t('message.message.multi_model_style.vertical') },
                { value: 'horizontal', label: t('message.message.multi_model_style.horizontal') },
                { value: 'grid', label: t('message.message.multi_model_style.grid') }
              ]}
            />
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            <SettingRowTitleSmall>{t('settings.messages.navigation.label')}</SettingRowTitleSmall>
            <Selector
              value={messageNavigation}
              onChange={(value) => dispatch(setMessageNavigation(value as 'none' | 'buttons' | 'anchor'))}
              options={[
                { value: 'none', label: t('settings.messages.navigation.none') },
                { value: 'buttons', label: t('settings.messages.navigation.buttons') },
                { value: 'anchor', label: t('settings.messages.navigation.anchor') }
              ]}
            />
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            <SettingRowTitleSmall>{t('settings.messages.math_engine.label')}</SettingRowTitleSmall>
            <Selector
              value={mathEngine}
              onChange={(value) => dispatch(setMathEngine(value as MathEngine))}
              options={[
                { value: 'KaTeX', label: 'KaTeX' },
                { value: 'MathJax', label: 'MathJax' },
                { value: 'none', label: t('settings.messages.math_engine.none') }
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
                onChangeComplete={(value) => dispatch(setFontSize(value))}
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
      <CollapsibleSettingGroup title={t('chat.settings.code.title')} defaultExpanded={true}>
        <SettingGroup>
          <SettingRow>
            <SettingRowTitleSmall>{t('message.message.code_style')}</SettingRowTitleSmall>
            <Selector
              value={codeStyle}
              onChange={(value) => onCodeStyleChange(value as CodeStyleVarious)}
              options={themeNames.map((theme) => ({
                value: theme,
                label: theme
              }))}
            />
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            <SettingRowTitleSmall>
              {t('chat.settings.code_execution.title')}
              <Tooltip title={t('chat.settings.code_execution.tip')}>
                <CircleHelp size={14} style={{ marginLeft: 4 }} color="var(--color-text-2)" />
              </Tooltip>
            </SettingRowTitleSmall>
            <Switch
              size="small"
              checked={codeExecution.enabled}
              onChange={(checked) => dispatch(setCodeExecution({ enabled: checked }))}
            />
          </SettingRow>
          {codeExecution.enabled && (
            <>
              <SettingDivider />
              <SettingRow style={{ paddingLeft: 8 }}>
                <SettingRowTitleSmall>
                  {t('chat.settings.code_execution.timeout_minutes.label')}
                  <Tooltip title={t('chat.settings.code_execution.timeout_minutes.tip')}>
                    <CircleHelp size={14} style={{ marginLeft: 4 }} color="var(--color-text-2)" />
                  </Tooltip>
                </SettingRowTitleSmall>
                <EditableNumber
                  size="small"
                  min={1}
                  max={60}
                  step={1}
                  value={codeExecution.timeoutMinutes}
                  onChange={(value) => dispatch(setCodeExecution({ timeoutMinutes: value ?? 1 }))}
                  style={{ width: 80 }}
                />
              </SettingRow>
            </>
          )}
          <SettingDivider />
          <SettingRow>
            <SettingRowTitleSmall>{t('chat.settings.code_editor.title')}</SettingRowTitleSmall>
            <Switch
              size="small"
              checked={codeEditor.enabled}
              onChange={(checked) => dispatch(setCodeEditor({ enabled: checked }))}
            />
          </SettingRow>
          {codeEditor.enabled && (
            <>
              <SettingDivider />
              <SettingRow style={{ paddingLeft: 8 }}>
                <SettingRowTitleSmall>{t('chat.settings.code_editor.highlight_active_line')}</SettingRowTitleSmall>
                <Switch
                  size="small"
                  checked={codeEditor.highlightActiveLine}
                  onChange={(checked) => dispatch(setCodeEditor({ highlightActiveLine: checked }))}
                />
              </SettingRow>
              <SettingDivider />
              <SettingRow style={{ paddingLeft: 8 }}>
                <SettingRowTitleSmall>{t('chat.settings.code_editor.fold_gutter')}</SettingRowTitleSmall>
                <Switch
                  size="small"
                  checked={codeEditor.foldGutter}
                  onChange={(checked) => dispatch(setCodeEditor({ foldGutter: checked }))}
                />
              </SettingRow>
              <SettingDivider />
              <SettingRow style={{ paddingLeft: 8 }}>
                <SettingRowTitleSmall>{t('chat.settings.code_editor.autocompletion')}</SettingRowTitleSmall>
                <Switch
                  size="small"
                  checked={codeEditor.autocompletion}
                  onChange={(checked) => dispatch(setCodeEditor({ autocompletion: checked }))}
                />
              </SettingRow>
              <SettingDivider />
              <SettingRow style={{ paddingLeft: 8 }}>
                <SettingRowTitleSmall>{t('chat.settings.code_editor.keymap')}</SettingRowTitleSmall>
                <Switch
                  size="small"
                  checked={codeEditor.keymap}
                  onChange={(checked) => dispatch(setCodeEditor({ keymap: checked }))}
                />
              </SettingRow>
            </>
          )}
          <SettingDivider />
          <SettingRow>
            <SettingRowTitleSmall>{t('chat.settings.show_line_numbers')}</SettingRowTitleSmall>
            <Switch
              size="small"
              checked={codeShowLineNumbers}
              onChange={(checked) => dispatch(setCodeShowLineNumbers(checked))}
            />
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            <SettingRowTitleSmall>{t('chat.settings.code_collapsible')}</SettingRowTitleSmall>
            <Switch
              size="small"
              checked={codeCollapsible}
              onChange={(checked) => dispatch(setCodeCollapsible(checked))}
            />
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            <SettingRowTitleSmall>{t('chat.settings.code_wrappable')}</SettingRowTitleSmall>
            <Switch size="small" checked={codeWrappable} onChange={(checked) => dispatch(setCodeWrappable(checked))} />
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            <SettingRowTitleSmall>{t('chat.settings.code_image_tools')}</SettingRowTitleSmall>
            <Switch
              size="small"
              checked={codeImageTools}
              onChange={(checked) => dispatch(setCodeImageTools(checked))}
            />
          </SettingRow>
        </SettingGroup>
        <SettingDivider />
      </CollapsibleSettingGroup>
      <CollapsibleSettingGroup title={t('settings.messages.input.title')} defaultExpanded={true}>
        <SettingGroup>
          <SettingRow>
            <SettingRowTitleSmall>{t('settings.messages.input.show_estimated_tokens')}</SettingRowTitleSmall>
            <Switch
              size="small"
              checked={showInputEstimatedTokens}
              onChange={(checked) => dispatch(setShowInputEstimatedTokens(checked))}
            />
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            <SettingRowTitleSmall>{t('settings.messages.input.paste_long_text_as_file')}</SettingRowTitleSmall>
            <Switch
              size="small"
              checked={pasteLongTextAsFile}
              onChange={(checked) => dispatch(setPasteLongTextAsFile(checked))}
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
                  onChange={(value) => dispatch(setPasteLongTextThreshold(value ?? 500))}
                  style={{ width: 80 }}
                />
              </SettingRow>
            </>
          )}
          <SettingDivider />
          <SettingRow>
            <SettingRowTitleSmall>{t('settings.messages.markdown_rendering_input_message')}</SettingRowTitleSmall>
            <Switch
              size="small"
              checked={renderInputMessageAsMarkdown}
              onChange={(checked) => dispatch(setRenderInputMessageAsMarkdown(checked))}
            />
          </SettingRow>
          <SettingDivider />
          {!language.startsWith('en') && (
            <>
              <SettingRow>
                <SettingRowTitleSmall>{t('settings.input.auto_translate_with_space')}</SettingRowTitleSmall>
                <Switch
                  size="small"
                  checked={autoTranslateWithSpace}
                  onChange={(checked) => dispatch(setAutoTranslateWithSpace(checked))}
                />
              </SettingRow>
              <SettingDivider />
            </>
          )}
          <SettingRow>
            <SettingRowTitleSmall>{t('settings.input.show_translate_confirm')}</SettingRowTitleSmall>
            <Switch
              size="small"
              checked={showTranslateConfirm}
              onChange={(checked) => dispatch(setShowTranslateConfirm(checked))}
            />
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            <SettingRowTitleSmall>{t('settings.messages.input.enable_quick_triggers')}</SettingRowTitleSmall>
            <Switch
              size="small"
              checked={enableQuickPanelTriggers}
              onChange={(checked) => dispatch(setEnableQuickPanelTriggers(checked))}
            />
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            <SettingRowTitleSmall>{t('settings.messages.input.enable_delete_model')}</SettingRowTitleSmall>
            <Switch
              size="small"
              checked={enableBackspaceDeleteModel}
              onChange={(checked) => dispatch(setEnableBackspaceDeleteModel(checked))}
            />
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            <SettingRowTitleSmall>{t('settings.input.target_language.label')}</SettingRowTitleSmall>
            <Selector
              value={targetLanguage}
              onChange={(value) => setTargetLanguage(value)}
              placeholder={UNKNOWN.emoji + ' ' + UNKNOWN.label()}
              options={translateLanguages.map((item) => {
                return { value: item.langCode, label: item.emoji + ' ' + item.label() }
              })}
            />
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            <SettingRowTitleSmall>{t('settings.messages.input.send_shortcuts')}</SettingRowTitleSmall>
            <Selector
              value={sendMessageShortcut}
              onChange={(value) => setSendMessageShortcut(value as SendMessageShortcut)}
              options={[
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
`

const SettingGroup = styled.div<{ theme?: ThemeMode }>`
  padding: 0 5px;
  width: 100%;
  margin-top: 0;
  border-radius: 8px;
  margin-bottom: 10px;
`

export default SettingsTab
