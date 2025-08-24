import {
  CheckOutlined,
  EditOutlined,
  EyeOutlined,
  PlusOutlined,
  QuestionCircleOutlined,
  ReloadOutlined
} from '@ant-design/icons'
import CodeEditor from '@renderer/components/CodeEditor'
import { Box } from '@renderer/components/Layout'
import { FOOTNOTE_PROMPT, REFERENCE_PROMPT } from '@renderer/config/prompts'
import { estimateTextTokens } from '@renderer/services/TokenService'
import { useAppSelector } from '@renderer/store'
import { Assistant, AssistantSettings } from '@renderer/types'
import { Button, Divider, Row, Segmented, Select, SelectProps, Switch, Tooltip } from 'antd'
import { CircleHelp } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import remarkGfm from 'remark-gfm'
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
  // 依据当前 assistant 推导初始提示词与预览默认显示
  const initialCitationMode = assistant.knowledgePromptSettings?.citationMode || 'number'
  const initialHasCustomPrompt = assistant.knowledgePromptSettings?.referencePrompt !== undefined
  const initialPrompt = initialHasCustomPrompt
    ? (assistant.knowledgePromptSettings?.referencePrompt as string)
    : initialCitationMode === 'footnote'
      ? FOOTNOTE_PROMPT
      : REFERENCE_PROMPT
  const [showPreview, setShowPreview] = useState<boolean>((initialPrompt?.length ?? 0) > 0)
  const editorRef = useRef<any>(null)
  // 自适应高度（与智能体提示词一致的风格）
  const EDITOR_HEIGHT = 'calc(80vh - 260px)'
  // Token 计数
  const [tokenCount, setTokenCount] = useState(0)

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
    // 使用 CodeEditor 提供的 insertText 方法在光标位置插入变量
    if (editorRef.current && editorRef.current.insertText) {
      editorRef.current.insertText(variable)
    } else {
      // 降级方案：如果没有 insertText 方法，追加到末尾
      const newValue = (currentPrompt || '') + variable
      handlePromptSettingsChange('referencePrompt', newValue)
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
  // 仅当 referencePrompt 为 undefined 时，才使用默认提示词；空字符串视为“用户清空”而不是缺省
  const hasCustomPrompt = assistant.knowledgePromptSettings?.referencePrompt !== undefined
  const currentPrompt = hasCustomPrompt
    ? (assistant.knowledgePromptSettings?.referencePrompt as string)
    : currentCitationMode === 'footnote'
      ? FOOTNOTE_PROMPT
      : REFERENCE_PROMPT

  // 检查提示词中是否已包含变量
  const hasQuestionVariable = currentPrompt.includes('{question}')
  const hasReferencesVariable = currentPrompt.includes('{references}')

  // 预览文本：用 HTML 标签占位变量，交给 ReactMarkdown 渲染（rehypeRaw 允许 HTML）
  const previewMarkdown = `${currentPrompt}`
    .replaceAll(
      '{question}',
      `<span class="kb-var kb-question">${t(
        'assistants.settings.knowledge_base.prompt_settings.custom_prompt.insert_question'
      )}</span>`
    ) // 蓝色
    .replaceAll(
      '{references}',
      `<span class="kb-var kb-references">${t(
        'assistants.settings.knowledge_base.prompt_settings.custom_prompt.insert_references'
      )}</span>`
    ) // 绿色

  // 计算 Token（与智能体提示词一致）
  useEffect(() => {
    let disposed = false
    const run = async () => {
      const count = await estimateTextTokens(currentPrompt || '')
      if (!disposed) setTokenCount(count)
    }
    run()
    return () => {
      disposed = true
    }
  }, [currentPrompt])

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
              // 仅当未设置 referencePrompt（undefined）时，切换模式同步默认提示词
              if (assistant.knowledgePromptSettings?.referencePrompt === undefined) {
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

          <div style={{ display: showPreview ? 'none' : 'block' }}>
            <CodeEditor
              ref={editorRef}
              value={currentPrompt}
              language="markdown"
              placeholder={t('assistants.settings.knowledge_base.prompt_settings.custom_prompt.placeholder')}
              onChange={(val) => handlePromptChange(val)}
              onBlur={() => handlePromptBlur()}
              height={EDITOR_HEIGHT}
              fontSize="var(--ant-font-size)"
              expanded
              unwrapped={false}
              editable={promptSettingsEnabled}
              options={{
                autocompletion: false,
                keymap: true,
                lineNumbers: false,
                lint: false
              }}
              style={{
                border: '0.5px solid var(--color-border)',
                borderRadius: '5px'
              }}
            />
          </div>

          {showPreview && (
            <PreviewContainer
              $height={EDITOR_HEIGHT}
              className="markdown"
              onClick={() => setShowPreview(false)}
              title={t('common.edit') as string}>
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                {previewMarkdown}
              </ReactMarkdown>
            </PreviewContainer>
          )}

          {/* 底部左侧 Token 计数，与智能体提示词一致 */}
          <FooterBar>
            <TokenCount>Tokens: {tokenCount}</TokenCount>
          </FooterBar>
        </PromptSettingsContent>
      </PromptSettingsSection>
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

// 使用 CodeEditor 替代原 TextArea；保留预览容器与变量样式。

const PreviewContainer = styled.div<{ $height: string }>`
  padding: 12px;
  background: var(--color-bg-2);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  min-height: ${(props) => props.$height};
  max-height: ${(props) => props.$height};
  overflow-y: auto;
  font-family: var(--font-family);
  line-height: 1.75;
  cursor: pointer;

  /* 变量彩色标记样式（与 VariableTag 视觉一致）*/
  .kb-var {
    display: inline-block;
    padding: 2px 8px;
    margin: 0 2px;
    color: #fff;
    border-radius: 4px;
    font-weight: 500;
    font-size: 12px;
    vertical-align: baseline;
    white-space: nowrap;
  }
  .kb-question {
    background: #1890ff;
  }
  .kb-references {
    background: #52c41a;
  }
`

// 变量彩色标识在预览中用 .kb-var 类名渲染，无需额外组件样式。

const FooterBar = styled.div`
  display: flex;
  justify-content: flex-start;
  align-items: center;
  margin-top: 8px;
  min-height: 24px;
`

const TokenCount = styled.div`
  padding: 2px 2px;
  border-radius: 4px;
  font-size: 14px;
  color: var(--color-text-2);
  user-select: none;
`

export default AssistantKnowledgeBaseSettings
