import { useCodeStyle } from '@renderer/context/CodeStyleProvider'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useSettings } from '@renderer/hooks/useSettings'
import { SettingDivider, SettingRow, SettingRowTitle } from '@renderer/pages/settings'
import { useAppDispatch } from '@renderer/store'
import {
  setCodeCollapsible,
  setCodeEditor,
  setCodeExecution,
  setCodePreview,
  setCodeShowLineNumbers,
  setCodeWrappable,
  setFontSize,
  setMathEngine,
  setMessageFont,
  setMessageNavigation,
  setMessageStyle,
  setMultiModelMessageStyle,
  setShowMessageDivider,
  setThoughtAutoCollapse
} from '@renderer/store/settings'
import { CodeStyleVarious, MathEngine, ThemeMode } from '@renderer/types'
import { Col, InputNumber, Modal, Row, Select, Slider, Switch, Tooltip } from 'antd'
import { CircleHelp } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { TopView } from '../TopView'

interface ShowParams {
  title: string
}

interface Props extends ShowParams {
  resolve: (data: any) => void
}

const PopupContainer: React.FC<Props> = ({ title, resolve }) => {
  const [open, setOpen] = useState(true)

  const { messageStyle, fontSize } = useSettings()
  const { theme } = useTheme()
  const { themeNames } = useCodeStyle()

  const [fontSizeValue, setFontSizeValue] = useState(fontSize)
  const { t } = useTranslation()

  const dispatch = useAppDispatch()

  const {
    showMessageDivider,
    messageFont,
    codeShowLineNumbers,
    codeCollapsible,
    codeWrappable,
    codeEditor,
    codePreview,
    codeExecution,
    mathEngine,
    multiModelMessageStyle,
    thoughtAutoCollapse,
    messageNavigation
  } = useSettings()

  const codeStyle = useMemo(() => {
    return codeEditor.enabled
      ? theme === ThemeMode.light
        ? codeEditor.themeLight
        : codeEditor.themeDark
      : theme === ThemeMode.light
        ? codePreview.themeLight
        : codePreview.themeDark
  }, [
    codeEditor.enabled,
    codeEditor.themeLight,
    codeEditor.themeDark,
    theme,
    codePreview.themeLight,
    codePreview.themeDark
  ])

  const onCodeStyleChange = useCallback(
    (value: CodeStyleVarious) => {
      const field = theme === ThemeMode.light ? 'themeLight' : 'themeDark'
      const action = codeEditor.enabled ? setCodeEditor : setCodePreview
      dispatch(action({ [field]: value }))
    },
    [dispatch, theme, codeEditor.enabled]
  )

  const onOk = () => {
    resolve(true)
    setOpen(false)
  }

  const onCancel = () => {
    resolve(false)
    setOpen(false)
  }

  const onClose = () => {
    TopView.hide(TopViewKey)
  }

  MessageSettingsPopup.hide = onCancel

  return (
    <Modal
      title={title}
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      afterClose={onClose}
      transitionName="animation-move-down"
      footer={null}
      centered>
      <SettingGroup>
        <SettingRow>
          <SettingRowTitleSmall>{t('settings.messages.divider')}</SettingRowTitleSmall>
          <Switch
            size="small"
            checked={showMessageDivider}
            onChange={(checked) => dispatch(setShowMessageDivider(checked))}
          />
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
            {t('chat.settings.thought_auto_collapse')}
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
          <SettingRowTitleSmall>{t('message.message.style')}</SettingRowTitleSmall>
          <StyledSelect
            value={messageStyle}
            onChange={(value) => dispatch(setMessageStyle(value as 'plain' | 'bubble'))}
            style={{ width: 135 }}
            size="small">
            <Select.Option value="plain">{t('message.message.style.plain')}</Select.Option>
            <Select.Option value="bubble">{t('message.message.style.bubble')}</Select.Option>
          </StyledSelect>
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitleSmall>{t('message.message.multi_model_style')}</SettingRowTitleSmall>
          <StyledSelect
            size="small"
            value={multiModelMessageStyle}
            onChange={(value) =>
              dispatch(setMultiModelMessageStyle(value as 'fold' | 'vertical' | 'horizontal' | 'grid'))
            }
            style={{ width: 135 }}>
            <Select.Option value="fold">{t('message.message.multi_model_style.fold')}</Select.Option>
            <Select.Option value="vertical">{t('message.message.multi_model_style.vertical')}</Select.Option>
            <Select.Option value="horizontal">{t('message.message.multi_model_style.horizontal')}</Select.Option>
            <Select.Option value="grid">{t('message.message.multi_model_style.grid')}</Select.Option>
          </StyledSelect>
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitleSmall>{t('settings.messages.navigation')}</SettingRowTitleSmall>
          <StyledSelect
            size="small"
            value={messageNavigation}
            onChange={(value) => dispatch(setMessageNavigation(value as 'none' | 'buttons' | 'anchor'))}
            style={{ width: 135 }}>
            <Select.Option value="none">{t('settings.messages.navigation.none')}</Select.Option>
            <Select.Option value="buttons">{t('settings.messages.navigation.buttons')}</Select.Option>
            <Select.Option value="anchor">{t('settings.messages.navigation.anchor')}</Select.Option>
          </StyledSelect>
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitleSmall>{t('settings.messages.math_engine')}</SettingRowTitleSmall>
          <StyledSelect
            value={mathEngine}
            onChange={(value) => dispatch(setMathEngine(value as MathEngine))}
            style={{ width: 135 }}
            size="small">
            <Select.Option value="KaTeX">KaTeX</Select.Option>
            <Select.Option value="MathJax">MathJax</Select.Option>
            <Select.Option value="none">{t('settings.messages.math_engine.none')}</Select.Option>
          </StyledSelect>
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
      </SettingGroup>
      <SettingGroup>
        <SettingRow>
          <SettingRowTitleSmall>{t('message.message.code_style')}</SettingRowTitleSmall>
          <StyledSelect
            value={codeStyle}
            onChange={(value) => onCodeStyleChange(value as CodeStyleVarious)}
            style={{ width: 135 }}
            size="small">
            {themeNames.map((theme) => (
              <Select.Option key={theme} value={theme}>
                {theme}
              </Select.Option>
            ))}
          </StyledSelect>
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
                {t('chat.settings.code_execution.timeout_minutes')}
                <Tooltip title={t('chat.settings.code_execution.timeout_minutes.tip')}>
                  <CircleHelp size={14} style={{ marginLeft: 4 }} color="var(--color-text-2)" />
                </Tooltip>
              </SettingRowTitleSmall>
              <InputNumber
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
      </SettingGroup>
    </Modal>
  )
}

const SettingRowTitleSmall = styled(SettingRowTitle)`
  font-size: 13px;
`

const SettingGroup = styled.div<{ theme?: ThemeMode }>`
  padding: 0;
  width: 100%;
  margin-top: 0;
  border-radius: 8px;
  margin-bottom: 10px;
  margin-top: 10px;
`

const StyledSelect = styled(Select)`
  .ant-select-selector {
    border-radius: 15px !important;
    padding: 4px 10px !important;
    height: 26px !important;
  }
`

const TopViewKey = 'MessageSettingsPopup'

export default class MessageSettingsPopup {
  static topviewId = 0
  static hide() {
    TopView.hide(TopViewKey)
  }
  static show(props: ShowParams) {
    return new Promise<any>((resolve) => {
      TopView.show(<PopupContainer {...props} resolve={resolve} />, TopViewKey)
    })
  }
}
