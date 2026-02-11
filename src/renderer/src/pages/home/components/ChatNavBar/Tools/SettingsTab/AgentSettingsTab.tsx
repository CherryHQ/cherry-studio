import { DescriptionSwitch, HelpTooltip } from '@cherrystudio/ui'
import { useMultiplePreferences, usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import EditableNumber from '@renderer/components/EditableNumber'
import Scrollbar from '@renderer/components/Scrollbar'
import Selector from '@renderer/components/Selector'
import { UNKNOWN } from '@renderer/config/translate'
import { useCodeStyle } from '@renderer/context/CodeStyleProvider'
import { useTheme } from '@renderer/context/ThemeProvider'
import { cacheService } from '@renderer/data/CacheService'
import useTranslate from '@renderer/hooks/useTranslate'
import { SettingDivider, SettingRow, SettingRowTitle } from '@renderer/pages/settings'
import { CollapsibleSettingGroup } from '@renderer/pages/settings/SettingGroup'
import type { CodeStyleVarious, MathEngine } from '@renderer/types'
import { getSendMessageShortcutLabel } from '@renderer/utils/input'
import type { SendMessageShortcut } from '@shared/data/preference/preferenceTypes'
import { ThemeMode } from '@shared/data/preference/preferenceTypes'
import { Col, Row, Slider } from 'antd'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const logger = loggerService.withContext('AgentSettingsTab')

const AgentSettingsTab = () => {
  const [messageStyle, setMessageStyle] = usePreference('chat.message.style')
  const [fontSize, setFontSize] = usePreference('chat.message.font_size')
  const [language] = usePreference('app.language')
  const [messageFont, setMessageFont] = usePreference('chat.message.font')
  const [thoughtAutoCollapse, setThoughtAutoCollapse] = usePreference('chat.message.thought.auto_collapse')
  const [messageNavigation, setMessageNavigation] = usePreference('chat.message.navigation_mode')
  const [mathEngine, setMathEngine] = usePreference('chat.message.math.engine')
  const [mathEnableSingleDollar, setMathEnableSingleDollar] = usePreference('chat.message.math.single_dollar')
  const [codeShowLineNumbers, setCodeShowLineNumbers] = usePreference('chat.code.show_line_numbers')
  const [codeCollapsible, setCodeCollapsible] = usePreference('chat.code.collapsible')
  const [codeWrappable, setCodeWrappable] = usePreference('chat.code.wrappable')
  const [codeImageTools, setCodeImageTools] = usePreference('chat.code.image_tools')
  const [codeFancyBlock, setCodeFancyBlock] = usePreference('chat.code.fancy_block')
  const [pasteLongTextAsFile, setPasteLongTextAsFile] = usePreference('chat.input.paste_long_text_as_file')
  const [pasteLongTextThreshold, setPasteLongTextThreshold] = usePreference('chat.input.paste_long_text_threshold')
  const [renderInputMessageAsMarkdown, setRenderInputMessageAsMarkdown] = usePreference(
    'chat.message.render_as_markdown'
  )
  const [autoTranslateWithSpace, setAutoTranslateWithSpace] = usePreference(
    'chat.input.translate.auto_translate_with_space'
  )
  const [showTranslateConfirm, setShowTranslateConfirm] = usePreference('chat.input.translate.show_confirm')
  const [enableQuickPanelTriggers, setEnableQuickPanelTriggers] = usePreference(
    'chat.input.quick_panel.triggers_enabled'
  )
  const [confirmDeleteMessage, setConfirmDeleteMessage] = usePreference('chat.message.confirm_delete')
  const [confirmRegenerateMessage, setConfirmRegenerateMessage] = usePreference('chat.message.confirm_regenerate')
  const [sendMessageShortcut, setSendMessageShortcut] = usePreference('chat.input.send_message_shortcut')
  const [targetLanguage, setTargetLanguage] = usePreference('feature.translate.target_language')

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

  const { theme } = useTheme()
  const { themeNames } = useCodeStyle()

  const [fontSizeValue, setFontSizeValue] = useState(fontSize)
  const { translateLanguages } = useTranslate()

  const { t } = useTranslation()

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

  const activeView = cacheService.get('chat.active_view')
  const isAgentSettings = activeView === 'session'
  if (!isAgentSettings) {
    logger.warn('AgentSettingsTab is rendered when not session activated.')
    return null
  }

  return (
    <Container className="settings-tab">
      <CollapsibleSettingGroup title={t('settings.messages.title')} defaultExpanded={true}>
        <SettingGroup>
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
          <SettingRow>
            <SettingRowTitleSmall>{t('message.message.style.label')}</SettingRowTitleSmall>
            <Selector
              value={messageStyle}
              onChange={(value) => setMessageStyle(value as 'plain' | 'bubble')}
              options={[
                { value: 'plain', label: t('message.message.style.plain') },
                { value: 'bubble', label: t('message.message.style.bubble') }
              ]}
            />
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            <SettingRowTitleSmall>{t('settings.messages.navigation.label')}</SettingRowTitleSmall>
            <Selector
              value={messageNavigation}
              onChange={(value) => setMessageNavigation(value as 'none' | 'buttons' | 'anchor')}
              options={[
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
            <SettingRowTitleSmall>{t('settings.math.engine.label')}</SettingRowTitleSmall>
            <Selector
              value={mathEngine}
              onChange={(value) => setMathEngine(value as MathEngine)}
              options={[
                { value: 'KaTeX', label: 'KaTeX' },
                { value: 'MathJax', label: 'MathJax' },
                { value: 'none', label: t('settings.math.engine.none') }
              ]}
            />
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
  gap: 4px;
`

const SettingGroup = styled.div<{ theme?: ThemeMode }>`
  padding: 0 5px;
  width: 100%;
  margin-top: 0;
  border-radius: 8px;
  margin-bottom: 10px;
`

export default AgentSettingsTab
