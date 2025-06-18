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
import { Col, InputNumber, Modal, Row, Slider, Switch, Tooltip } from 'antd'
import { CircleHelp } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import Selector from '../Selector'
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
      centered
      styles={{ body: { maxHeight: '70vh', overflowY: 'auto' } }}>
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
          <Selector
            value={messageStyle}
            onChange={(value) => dispatch(setMessageStyle(value as 'plain' | 'bubble'))}
            options={[
              { label: t('message.message.style.plain'), value: 'plain' },
              { label: t('message.message.style.bubble'), value: 'bubble' }
            ]}
          />
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitleSmall>{t('message.message.multi_model_style')}</SettingRowTitleSmall>
          <Selector
            value={multiModelMessageStyle}
            onChange={(value) =>
              dispatch(setMultiModelMessageStyle(value as 'fold' | 'vertical' | 'horizontal' | 'grid'))
            }
            options={[
              { label: t('message.message.multi_model_style.fold'), value: 'fold' },
              { label: t('message.message.multi_model_style.vertical'), value: 'vertical' },
              { label: t('message.message.multi_model_style.horizontal'), value: 'horizontal' },
              { label: t('message.message.multi_model_style.grid'), value: 'grid' }
            ]}
          />
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitleSmall>{t('settings.messages.navigation')}</SettingRowTitleSmall>
          <Selector
            value={messageNavigation}
            onChange={(value) => dispatch(setMessageNavigation(value as 'none' | 'buttons' | 'anchor'))}
            options={[
              { label: t('settings.messages.navigation.none'), value: 'none' },
              { label: t('settings.messages.navigation.buttons'), value: 'buttons' },
              { label: t('settings.messages.navigation.anchor'), value: 'anchor' }
            ]}
          />
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitleSmall>{t('settings.messages.math_engine')}</SettingRowTitleSmall>
          <Selector
            value={mathEngine}
            onChange={(value) => dispatch(setMathEngine(value as MathEngine))}
            options={[
              { label: 'KaTeX', value: 'KaTeX' },
              { label: 'MathJax', value: 'MathJax' },
              { label: t('settings.messages.math_engine.none'), value: 'none' }
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
      </SettingGroup>
      <SettingGroup>
        <SettingRow>
          <SettingRowTitleSmall>{t('message.message.code_style')}</SettingRowTitleSmall>
          <Selector
            value={codeStyle}
            onChange={(value) => onCodeStyleChange(value as CodeStyleVarious)}
            options={themeNames.map((theme) => ({ label: theme, value: theme }))}
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
