import { CheckOutlined, PlusOutlined, QuestionCircleOutlined, ReloadOutlined } from '@ant-design/icons'
import { Box } from '@renderer/components/Layout'
import { FOOTNOTE_PROMPT, REFERENCE_PROMPT } from '@renderer/config/prompts'
import { useAppSelector } from '@renderer/store'
import { Assistant, AssistantSettings } from '@renderer/types'
import { Button, Divider, Row, Segmented, Select, SelectProps, Switch, Tooltip } from 'antd'
import TextArea from 'antd/es/input/TextArea'
import { CircleHelp } from 'lucide-react'
import { useRef, useState } from 'react'
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
  }

  const insertVariable = (variable: string) => {
    const textArea = textAreaRef.current?.resizableTextArea?.textArea
    if (textArea) {
      const start = textArea.selectionStart
      const end = textArea.selectionEnd
      const currentValue = currentPrompt
      const newValue = currentValue.substring(0, start) + variable + currentValue.substring(end)
      handlePromptSettingsChange('referencePrompt', newValue)

      // 设置光标位置到插入的变量之后
      setTimeout(() => {
        textArea.focus()
        const newPosition = start + variable.length
        textArea.setSelectionRange(newPosition, newPosition)
      }, 10)
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
                    <QuestionIcon size={15} />
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
          <Box style={{ fontWeight: 'bold', display: 'flex', alignItems: 'center' }}>
            {t('assistants.settings.knowledge_base.prompt_settings.title')}
            <Switch
              checked={promptSettingsEnabled}
              onChange={handlePromptSettingsEnabledChange}
              style={{ marginLeft: 12 }}
            />
          </Box>
        </Row>

        <PromptSettingsContent $disabled={!promptSettingsEnabled}>
          <Row align="middle" style={{ marginBottom: 15 }}>
            <Label>{t('assistants.settings.knowledge_base.prompt_settings.citation_mode.label')}</Label>
            <Tooltip title={t('assistants.settings.knowledge_base.prompt_settings.citation_mode.tooltip')}>
              <QuestionCircleOutlined style={{ marginLeft: 8, color: 'var(--color-text-3)', cursor: 'pointer' }} />
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
                      <QuestionCircleOutlined style={{ fontSize: 14, color: 'var(--color-text-3)' }} />
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
                      <QuestionCircleOutlined style={{ fontSize: 14, color: 'var(--color-text-3)' }} />
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
                <QuestionCircleOutlined style={{ marginLeft: 8, color: 'var(--color-text-3)', cursor: 'pointer' }} />
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
          </VariableButtonsContainer>

          <CustomTextArea
            ref={textAreaRef}
            value={currentPrompt}
            onChange={(e) => handlePromptSettingsChange('referencePrompt', e.target.value)}
            placeholder={t('assistants.settings.knowledge_base.prompt_settings.custom_prompt.placeholder')}
            rows={8}
            disabled={!promptSettingsEnabled}
          />
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
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
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

export default AssistantKnowledgeBaseSettings
