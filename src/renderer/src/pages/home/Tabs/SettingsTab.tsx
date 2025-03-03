import { CheckOutlined, QuestionCircleOutlined, ReloadOutlined } from '@ant-design/icons'
import { HStack } from '@renderer/components/Layout'
import Scrollbar from '@renderer/components/Scrollbar'
import {
  DEFAULT_CONTEXTCOUNT,
  DEFAULT_MAX_TOKENS,
  DEFAULT_TEMPERATURE,
  isMac,
  isWindows
} from '@renderer/config/constant'
import { isReasoningModel } from '@renderer/config/models'
import { codeThemes } from '@renderer/context/SyntaxHighlighterProvider'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useSettings } from '@renderer/hooks/useSettings'
import { SettingDivider, SettingRow, SettingRowTitle, SettingSubtitle } from '@renderer/pages/settings'
import { useAppDispatch } from '@renderer/store'
import {
  setAutoTranslateWithSpace,
  setCodeCollapsible,
  setCodeShowLineNumbers,
  setCodeStyle,
  setFontSize,
  setMathEngine,
  setMessageFont,
  setMessageStyle,
  setMultiModelMessageStyle,
  setPasteLongTextAsFile,
  setPasteLongTextThreshold,
  setRenderInputMessageAsMarkdown,
  setShowInputEstimatedTokens,
  setShowMessageDivider,
  setThoughtAutoCollapse
} from '@renderer/store/settings'
import { Assistant, AssistantSettings, ThemeMode, TranslateLanguageVarious } from '@renderer/types'
import { modalConfirm } from '@renderer/utils'
import { Col, InputNumber, Row, Segmented, Select, Slider, Switch, Tooltip } from 'antd'
import { FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  assistant: Assistant
}

const SettingsTab: FC<Props> = (props) => {
  const { assistant, updateAssistantSettings, updateAssistant } = useAssistant(props.assistant.id)
  const { messageStyle, codeStyle, fontSize, language } = useSettings()

  const [temperature, setTemperature] = useState(assistant?.settings?.temperature ?? DEFAULT_TEMPERATURE)
  const [contextCount, setContextCount] = useState(assistant?.settings?.contextCount ?? DEFAULT_CONTEXTCOUNT)
  const [enableMaxTokens, setEnableMaxTokens] = useState(assistant?.settings?.enableMaxTokens ?? false)
  const [maxTokens, setMaxTokens] = useState(assistant?.settings?.maxTokens ?? 0)
  const [fontSizeValue, setFontSizeValue] = useState(fontSize)
  const [streamOutput, setStreamOutput] = useState(assistant?.settings?.streamOutput ?? true)
  const [reasoningEffort, setReasoningEffort] = useState(assistant?.settings?.reasoning_effort)
  const { t } = useTranslation()

  const dispatch = useAppDispatch()

  const {
    showMessageDivider,
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
    mathEngine,
    autoTranslateWithSpace,
    pasteLongTextThreshold,
    multiModelMessageStyle,
    thoughtAutoCollapse
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

  const onReasoningEffortChange = (value) => {
    updateAssistantSettings({ reasoning_effort: value })
  }

  const onReset = () => {
    setTemperature(DEFAULT_TEMPERATURE)
    setContextCount(DEFAULT_CONTEXTCOUNT)
    setReasoningEffort(undefined)
    updateAssistant({
      ...assistant,
      settings: {
        ...assistant.settings,
        temperature: DEFAULT_TEMPERATURE,
        contextCount: DEFAULT_CONTEXTCOUNT,
        enableMaxTokens: false,
        maxTokens: DEFAULT_MAX_TOKENS,
        streamOutput: true,
        hideMessages: false,
        reasoning_effort: undefined,
        customParameters: []
      }
    })
  }

  useEffect(() => {
    setTemperature(assistant?.settings?.temperature ?? DEFAULT_TEMPERATURE)
    setContextCount(assistant?.settings?.contextCount ?? DEFAULT_CONTEXTCOUNT)
    setEnableMaxTokens(assistant?.settings?.enableMaxTokens ?? false)
    setMaxTokens(assistant?.settings?.maxTokens ?? DEFAULT_MAX_TOKENS)
    setStreamOutput(assistant?.settings?.streamOutput ?? true)
    setReasoningEffort(assistant?.settings?.reasoning_effort)
  }, [assistant])

  return (
    <Container className="settings-tab">
      <SettingGroup style={{ marginTop: 10 }}>
        <SettingSubtitle style={{ marginTop: 0 }}>
          {t('settings.messages.model.title')}{' '}
          <Tooltip title={t('chat.settings.reset')}>
            <ReloadOutlined onClick={onReset} style={{ cursor: 'pointer', fontSize: 12, padding: '0 3px' }} />
          </Tooltip>
        </SettingSubtitle>
        <SettingDivider />
        <Row align="middle">
          <Label>{t('chat.settings.temperature')}</Label>
          <Tooltip title={t('chat.settings.temperature.tip')}>
            <QuestionIcon />
          </Tooltip>
        </Row>
        <Row align="middle" gutter={10}>
          <Col span={24}>
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
        <Row align="middle">
          <Label>{t('chat.settings.context_count')}</Label>
          <Tooltip title={t('chat.settings.context_count.tip')}>
            <QuestionIcon />
          </Tooltip>
        </Row>
        <Row align="middle" gutter={10}>
          <Col span={24}>
            <Slider
              min={0}
              max={20}
              onChange={setContextCount}
              onChangeComplete={onContextCountChange}
              value={typeof contextCount === 'number' ? contextCount : 0}
              step={1}
            />
          </Col>
        </Row>
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
        <Row align="middle" justify="space-between" style={{ marginBottom: 10 }}>
          <HStack alignItems="center">
            <Label>{t('chat.settings.max_tokens')}</Label>
            <Tooltip title={t('chat.settings.max_tokens.tip')}>
              <QuestionIcon />
            </Tooltip>
          </HStack>
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
        </Row>
        {enableMaxTokens && (
          <Row align="middle" gutter={10}>
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
        {isReasoningModel(assistant?.model) && (
          <>
            <SettingDivider />
            <Row align="middle">
              <Label>{t('assistants.settings.reasoning_effort')}</Label>
              <Tooltip title={t('assistants.settings.reasoning_effort.tip')}>
                <QuestionIcon />
              </Tooltip>
            </Row>
            <Row align="middle" gutter={10}>
              <Col span={24}>
                <SegmentedContainer>
                  <Segmented<'low' | 'medium' | 'high' | undefined>
                    value={reasoningEffort}
                    onChange={(value) => {
                      setReasoningEffort(value)
                      onReasoningEffortChange(value)
                    }}
                    options={[
                      {
                        value: 'low',
                        label: t('assistants.settings.reasoning_effort.low')
                      },
                      {
                        value: 'medium',
                        label: t('assistants.settings.reasoning_effort.medium')
                      },
                      {
                        value: 'high',
                        label: t('assistants.settings.reasoning_effort.high')
                      },
                      {
                        value: undefined,
                        label: t('assistants.settings.reasoning_effort.off')
                      }
                    ]}
                    block
                  />
                </SegmentedContainer>
              </Col>
            </Row>
          </>
        )}
      </SettingGroup>
      <SettingGroup>
        <SettingSubtitle style={{ marginTop: 0 }}>{t('settings.messages.title')}</SettingSubtitle>
        <SettingDivider />
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
          <SettingRowTitleSmall>
            {t('chat.settings.thought_auto_collapse')}
            <Tooltip title={t('chat.settings.thought_auto_collapse.tip')}>
              <QuestionIcon style={{ marginLeft: 4 }} />
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
          <Select
            value={messageStyle}
            onChange={(value) => dispatch(setMessageStyle(value))}
            style={{ width: 135 }}
            size="small">
            <Select.Option value="plain">{t('message.message.style.plain')}</Select.Option>
            <Select.Option value="bubble">{t('message.message.style.bubble')}</Select.Option>
          </Select>
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitleSmall>{t('message.message.multi_model_style')}</SettingRowTitleSmall>
          <Select
            size="small"
            value={multiModelMessageStyle}
            onChange={(value) => dispatch(setMultiModelMessageStyle(value))}
            style={{ width: 135 }}>
            <Select.Option value="fold">{t('message.message.multi_model_style.fold')}</Select.Option>
            <Select.Option value="vertical">{t('message.message.multi_model_style.vertical')}</Select.Option>
            <Select.Option value="horizontal">{t('message.message.multi_model_style.horizontal')}</Select.Option>
            <Select.Option value="grid">{t('message.message.multi_model_style.grid')}</Select.Option>
          </Select>
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitleSmall>{t('message.message.code_style')}</SettingRowTitleSmall>
          <Select
            value={codeStyle}
            onChange={(value) => dispatch(setCodeStyle(value))}
            style={{ width: 135 }}
            size="small">
            {codeThemes.map((theme) => (
              <Select.Option key={theme} value={theme}>
                {theme}
              </Select.Option>
            ))}
          </Select>
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitleSmall>{t('settings.messages.math_engine')}</SettingRowTitleSmall>
          <Select
            value={mathEngine}
            onChange={(value) => dispatch(setMathEngine(value))}
            style={{ width: 135 }}
            size="small">
            <Select.Option value="KaTeX">KaTeX</Select.Option>
            <Select.Option value="MathJax">MathJax</Select.Option>
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
        <SettingSubtitle style={{ marginTop: 0 }}>{t('settings.messages.input.title')}</SettingSubtitle>
        <SettingDivider />
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
              <InputNumber
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
          <SettingRowTitleSmall>{t('settings.input.target_language')}</SettingRowTitleSmall>
          <Select
            defaultValue={'english' as TranslateLanguageVarious}
            size="small"
            value={targetLanguage}
            menuItemSelectedIcon={<CheckOutlined />}
            options={[
              { value: 'chinese', label: t('settings.input.target_language.chinese') },
              { value: 'chinese-traditional', label: t('settings.input.target_language.chinese-traditional') },
              { value: 'english', label: t('settings.input.target_language.english') },
              { value: 'japanese', label: t('settings.input.target_language.japanese') },
              { value: 'russian', label: t('settings.input.target_language.russian') }
            ]}
            onChange={(value) => setTargetLanguage(value)}
            style={{ width: 135 }}
          />
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitleSmall>{t('settings.messages.input.send_shortcuts')}</SettingRowTitleSmall>
          <Select
            size="small"
            value={sendMessageShortcut}
            menuItemSelectedIcon={<CheckOutlined />}
            options={[
              { value: 'Enter', label: 'Enter' },
              { value: 'Shift+Enter', label: 'Shift + Enter' },
              { value: 'Ctrl+Enter', label: 'Ctrl + Enter' },
              { value: 'Command+Enter', label: `${isMac ? '⌘' : isWindows ? 'Win' : 'Super'} + Enter` }
            ]}
            onChange={(value) => setSendMessageShortcut(value)}
            style={{ width: 135 }}
          />
        </SettingRow>
      </SettingGroup>
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
`

const Label = styled.p`
  margin: 0;
  font-size: 12px;
  margin-right: 5px;
`

const QuestionIcon = styled(QuestionCircleOutlined)`
  font-size: 12px;
  cursor: pointer;
  color: var(--color-text-3);
`

const SettingRowTitleSmall = styled(SettingRowTitle)`
  font-size: 13px;
`

export const SettingGroup = styled.div<{ theme?: ThemeMode }>`
  padding: 0 5px;
  width: 100%;
  margin-top: 0;
  border-radius: 8px;
  margin-bottom: 10px;
`

// Define the styled component with hover state styling
const SegmentedContainer = styled.div`
  margin-top: 5px;
  .ant-segmented-item {
    font-size: 12px;
  }
  .ant-segmented-item-selected {
    background-color: var(--color-primary) !important;
    color: white !important;
  }

  .ant-segmented-item:hover:not(.ant-segmented-item-selected) {
    background-color: var(--color-primary-bg) !important;
    color: var(--color-primary) !important;
  }

  .ant-segmented-thumb {
    background-color: var(--color-primary) !important;
  }
`

export default SettingsTab
