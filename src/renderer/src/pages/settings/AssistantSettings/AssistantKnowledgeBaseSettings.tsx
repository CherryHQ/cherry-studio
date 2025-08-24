import {
  CheckOutlined,
  EditOutlined,
  EyeOutlined,
  PlusOutlined,
  QuestionCircleOutlined,
  ReloadOutlined
} from '@ant-design/icons'
import { Box } from '@renderer/components/Layout'
import { FOOTNOTE_PROMPT, REFERENCE_PROMPT } from '@renderer/config/prompts'
import { useAppSelector } from '@renderer/store'
import { Assistant, AssistantSettings } from '@renderer/types'
import { Button, Divider, Row, Segmented, Select, SelectProps, Switch, Tooltip } from 'antd'
import TextArea from 'antd/es/input/TextArea'
import { CircleHelp } from 'lucide-react'
import { KeyboardEvent, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  assistant: Assistant
  updateAssistant: (assistant: Assistant) => void
  updateAssistantSettings: (settings: AssistantSettings) => void
}

const AssistantKnowledgeBaseSettings: React.FC<Props> = ({ assistant, updateAssistant }) => {
  const { t } = useTranslation()
  const [promptSettingsEnabled, setPromptSettingsEnabled] = useState(
    assistant.knowledgePromptSettings?.enabled ?? false
  )
  const [showPreview, setShowPreview] = useState(false)
  const textAreaRef = useRef<any>(null)

  const knowledgeState = useAppSelector((state) => state.knowledge)
  const knowledgeOptions: SelectProps['options'] = knowledgeState.bases.map((base) => ({
    label: base.name,
    value: base.id
  }))

  const onUpdate = (value) => {
    const knowledge_bases = value.map((id) => knowledgeState.bases.find((b) => b.id === id))
    const _assistant = { ...assistant, knowledge_bases }
    updateAssistant(_assistant)
  }

  const handlePromptSettingsChange = (key: 'referencePrompt' | 'citationMode' | 'enabled', value: string | boolean) => {
    const currentSettings = assistant.knowledgePromptSettings || {}
    updateAssistant({
      ...assistant,
      knowledgePromptSettings: {
        ...currentSettings,
        [key]: value
      }
    })
  }

  const handlePromptSettingsEnabledChange = (checked: boolean) => {
    setPromptSettingsEnabled(checked)
    handlePromptSettingsChange('enabled', checked)
  }

  const handleResetPrompt = () => {
    const currentSettings = assistant.knowledgePromptSettings || {}
    const defaultPrompt = currentSettings.citationMode === 'footnote' ? FOOTNOTE_PROMPT : REFERENCE_PROMPT
    handlePromptSettingsChange('referencePrompt', defaultPrompt)
    // 恢复默认时触发保存通知
    if (promptSettingsEnabled) {
      window.message.success(t('common.saved'))
    }
  }

  const insertVariable = (variable: string) => {
    const textArea = textAreaRef.current?.resizableTextArea?.textArea
    if (textArea) {
      const start = textArea.selectionStart
      const end = textArea.selectionEnd
      const currentValue = currentPrompt
      const newValue = currentValue.substring(0, start) + variable + currentValue.substring(end)

      // 保存当前滚动位置
      const scrollTop = textArea.scrollTop

      handlePromptSettingsChange('referencePrompt', newValue)

      // 设置光标位置到插入的变量之后
      setTimeout(() => {
        textArea.focus()
        const newPosition = start + variable.length
        textArea.setSelectionRange(newPosition, newPosition)

        // 恢复滚动位置
        textArea.scrollTop = scrollTop
      }, 0)
    }
  }

  // 处理键盘事件，实现智能删除变量
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!promptSettingsEnabled) return

    const textArea = e.currentTarget
    const { selectionStart, selectionEnd, value } = textArea

    // 只处理退格键且没有选择文本的情况
    if (e.key === 'Backspace' && selectionStart === selectionEnd && selectionStart > 0) {
      // 检查光标前是否是变量
      const beforeCursor = value.substring(0, selectionStart)

      // 检查是否是 {question} 变量
      if (beforeCursor.endsWith('{question}')) {
        e.preventDefault()
        const newValue = value.substring(0, selectionStart - 10) + value.substring(selectionStart)
        handlePromptSettingsChange('referencePrompt', newValue)

        // 设置光标位置
        setTimeout(() => {
          textArea.setSelectionRange(selectionStart - 10, selectionStart - 10)
        }, 0)
        return
      }

      // 检查是否是 {references} 变量
      if (beforeCursor.endsWith('{references}')) {
        e.preventDefault()
        const newValue = value.substring(0, selectionStart - 12) + value.substring(selectionStart)
        handlePromptSettingsChange('referencePrompt', newValue)

        // 设置光标位置
        setTimeout(() => {
          textArea.setSelectionRange(selectionStart - 12, selectionStart - 12)
        }, 0)
        return
      }
    }
  }

  // 处理提示词变化（不再自动保存）
  const handlePromptChange = (value: string) => {
    // 仅更新值，不触发保存
    updateAssistant({
      ...assistant,
      knowledgePromptSettings: {
        ...assistant.knowledgePromptSettings,
        referencePrompt: value
      }
    })
  }

  // 处理失去焦点时的保存
  const handlePromptBlur = () => {
    if (promptSettingsEnabled) {
      // 触发保存并显示通知
      window.message.success(t('common.saved'))
    }
  }

  const currentCitationMode = assistant.knowledgePromptSettings?.citationMode || 'number'
  const currentPrompt =
    assistant.knowledgePromptSettings?.referencePrompt ||
    (currentCitationMode === 'footnote' ? FOOTNOTE_PROMPT : REFERENCE_PROMPT)

  // 检查提示词中是否已包含变量
  const hasQuestionVariable = currentPrompt.includes('{question}')
  const hasReferencesVariable = currentPrompt.includes('{references}')

  return (
    <Container>
      <Box mb={8} style={{ fontWeight: 'bold' }}>
        {t('common.knowledge_base')}
      </Box>
      <Select
        mode="multiple"
        allowClear
        value={assistant.knowledge_bases?.map((b) => b.id)}
        placeholder={t('agents.add.knowledge_base.placeholder')}
        menuItemSelectedIcon={<CheckOutlined />}
        options={knowledgeOptions}
        onChange={(value) => onUpdate(value)}
        filterOption={(input, option) =>
          String(option?.label ?? '')
            .toLowerCase()
            .includes(input.toLowerCase())
        }
      />

      <Divider />

      <Row align="middle" style={{ marginBottom: 10 }}>
        <Label>{t('assistants.settings.knowledge_base.recognition.label')}</Label>
      </Row>
      <Row align="middle">
        <Segmented
          value={assistant.knowledgeRecognition ?? 'off'}
          options={[
            { label: t('assistants.settings.knowledge_base.recognition.off'), value: 'off' },
            {
              label: (
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  {t('assistants.settings.knowledge_base.recognition.on')}
                  <Tooltip title={t('assistants.settings.knowledge_base.recognition.tip')}>
                    <QuestionIcon size={15} style={{ color: 'var(--color-text-2)' }} />
                  </Tooltip>
                </div>
              ),
              value: 'on'
            }
          ]}
          onChange={(value) =>
            updateAssistant({
              ...assistant,
              knowledgeRecognition: value as 'off' | 'on'
            })
          }
        />
      </Row>

      <Divider />

      {/* 提示词设置 */}
      <PromptSettingsSection>
        <Row align="middle" justify="space-between" style={{ marginBottom: 15 }}>
          <Box style={{ fontWeight: 'bold' }}>{t('assistants.settings.knowledge_base.prompt_settings.title')}</Box>
          <Switch checked={promptSettingsEnabled} onChange={handlePromptSettingsEnabledChange} />
        </Row>

        <PromptSettingsContent $disabled={!promptSettingsEnabled}>
          <Row align="middle" style={{ marginBottom: 15 }}>
            <Label>{t('assistants.settings.knowledge_base.prompt_settings.citation_mode.label')}</Label>
            <Tooltip title={t('assistants.settings.knowledge_base.prompt_settings.citation_mode.tooltip')}>
              <QuestionCircleOutlined style={{ marginLeft: 8, color: 'var(--color-text-2)', cursor: 'pointer' }} />
            </Tooltip>
          </Row>
          <Segmented
            disabled={!promptSettingsEnabled}
            value={currentCitationMode}
            options={[
              {
                label: (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span>{t('assistants.settings.knowledge_base.prompt_settings.citation_mode.number')}</span>
                    <Tooltip
                      title={t('assistants.settings.knowledge_base.prompt_settings.citation_mode.number_tooltip')}>
                      <QuestionCircleOutlined style={{ fontSize: 14, color: 'var(--color-text-2)' }} />
                    </Tooltip>
                  </div>
                ),
                value: 'number'
              },
              {
                label: (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span>{t('assistants.settings.knowledge_base.prompt_settings.citation_mode.footnote')}</span>
                    <Tooltip
                      title={t('assistants.settings.knowledge_base.prompt_settings.citation_mode.footnote_tooltip')}>
                      <QuestionCircleOutlined style={{ fontSize: 14, color: 'var(--color-text-2)' }} />
                    </Tooltip>
                  </div>
                ),
                value: 'footnote'
              }
            ]}
            onChange={(value) => {
              handlePromptSettingsChange('citationMode', value as string)
              // 切换模式时，如果没有自定义提示词，则使用对应的默认提示词
              if (!assistant.knowledgePromptSettings?.referencePrompt) {
                const defaultPrompt = value === 'footnote' ? FOOTNOTE_PROMPT : REFERENCE_PROMPT
                handlePromptSettingsChange('referencePrompt', defaultPrompt)
              }
            }}
            style={{ marginBottom: 20 }}
          />

          <Row align="middle" justify="space-between" style={{ marginBottom: 10 }}>
            <Row align="middle">
              <Label>{t('assistants.settings.knowledge_base.prompt_settings.custom_prompt.label')}</Label>
              <Tooltip title={t('assistants.settings.knowledge_base.prompt_settings.custom_prompt.insert_tip')}>
                <QuestionCircleOutlined style={{ marginLeft: 8, color: 'var(--color-text-2)', cursor: 'pointer' }} />
              </Tooltip>
            </Row>
            <Button
              type="text"
              size="small"
              icon={<ReloadOutlined />}
              onClick={handleResetPrompt}
              disabled={!promptSettingsEnabled}>
              {t('assistants.settings.knowledge_base.prompt_settings.reset_to_default')}
            </Button>
          </Row>

          {/* 变量插入按钮 */}
          <VariableButtonsContainer>
            <VariableButton
              size="small"
              type="dashed"
              icon={<PlusOutlined />}
              disabled={!promptSettingsEnabled || hasQuestionVariable}
              onClick={() => insertVariable('{question}')}>
              <VariableText $color="#1890ff">
                {t('assistants.settings.knowledge_base.prompt_settings.custom_prompt.insert_question')}
              </VariableText>
            </VariableButton>
            <VariableButton
              size="small"
              type="dashed"
              icon={<PlusOutlined />}
              disabled={!promptSettingsEnabled || hasReferencesVariable}
              onClick={() => insertVariable('{references}')}>
              <VariableText $color="#52c41a">
                {t('assistants.settings.knowledge_base.prompt_settings.custom_prompt.insert_references')}
              </VariableText>
            </VariableButton>
            <Button
              size="small"
              type="text"
              icon={showPreview ? <EditOutlined /> : <EyeOutlined />}
              disabled={!promptSettingsEnabled}
              onClick={() => {
                setShowPreview(!showPreview)
                // 显示预览时触发保存通知，返回编辑时不触发
                if (!showPreview && promptSettingsEnabled) {
                  window.message.success(t('common.saved'))
                }
              }}>
              {showPreview ? t('common.back_to_edit', '返回编辑') : t('common.show_preview', '显示预览')}
            </Button>
          </VariableButtonsContainer>

          <CustomTextArea
            ref={textAreaRef}
            value={currentPrompt}
            onChange={(e) => handlePromptChange(e.target.value)}
            onBlur={handlePromptBlur}
            onKeyDown={handleKeyDown}
            placeholder={t('assistants.settings.knowledge_base.prompt_settings.custom_prompt.placeholder')}
            rows={8}
            disabled={!promptSettingsEnabled}
            style={{ display: showPreview ? 'none' : 'block' }}
          />

          {showPreview && (
            <PreviewContainer>
              {currentPrompt.split(/(\{question\}|\{references\})/g).map((part, index) => {
                if (part === '{question}') {
                  return (
                    <VariableTag key={index} $color="#1890ff">
                      {t('assistants.settings.knowledge_base.prompt_settings.custom_prompt.insert_question')}
                    </VariableTag>
                  )
                } else if (part === '{references}') {
                  return (
                    <VariableTag key={index} $color="#52c41a">
                      {t('assistants.settings.knowledge_base.prompt_settings.custom_prompt.insert_references')}
                    </VariableTag>
                  )
                }
                return <span key={index}>{part}</span>
              })}
            </PreviewContainer>
          )}
        </PromptSettingsContent>
      </PromptSettingsSection>

      <Divider />
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  overflow: hidden;
  padding: 5px;
`
const Label = styled.p`
  margin-right: 5px;
  font-weight: 500;
`

const QuestionIcon = styled(CircleHelp)`
  cursor: pointer;
  color: var(--color-text-3);
`

const PromptSettingsSection = styled.div`
  margin-top: 0;
`

const PromptSettingsContent = styled.div<{ $disabled: boolean }>`
  opacity: ${(props) => (props.$disabled ? 0.5 : 1)};
  pointer-events: ${(props) => (props.$disabled ? 'none' : 'auto')};
  transition: opacity 0.3s;
`

const VariableButtonsContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  flex-wrap: wrap;
`

const VariableButton = styled(Button)`
  &:not(:disabled):hover {
    transform: translateY(-1px);
  }
`

const VariableText = styled.span<{ $color: string }>`
  color: ${(props) => props.$color};
  font-weight: 500;
  margin-left: 4px;
`

const CustomTextArea = styled(TextArea)`
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-size: 13px;
  line-height: 1.5;
  position: relative;

  .ant-input {
    font-family: inherit;
  }
`

const PreviewContainer = styled.div`
  padding: 12px;
  background: var(--color-bg-2);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  min-height: 150px;
  max-height: 400px;
  overflow-y: auto;
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
`

const VariableTag = styled.span<{ $color: string }>`
  display: inline-block;
  padding: 2px 8px;
  margin: 0 2px;
  background: ${(props) => props.$color};
  color: white;
  border-radius: 4px;
  font-weight: 500;
  font-size: 12px;
  vertical-align: baseline;
`

export default AssistantKnowledgeBaseSettings
