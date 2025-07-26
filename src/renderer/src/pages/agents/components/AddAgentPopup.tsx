import 'emoji-picker-element'

import { CheckOutlined, LoadingOutlined, RollbackOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { loggerService } from '@logger'
import EmojiPicker from '@renderer/components/EmojiPicker'
import { TopView } from '@renderer/components/TopView'
import { AGENT_PROMPT } from '@renderer/config/prompts'
import { useAgents } from '@renderer/hooks/useAgents'
import { useSidebarIconShow } from '@renderer/hooks/useSidebarIcon'
import { fetchGenerate } from '@renderer/services/ApiService'
import { getDefaultModel } from '@renderer/services/AssistantService'
import { estimateTextTokens } from '@renderer/services/TokenService'
import { useAppSelector } from '@renderer/store'
import { Agent, KnowledgeBase } from '@renderer/types'
import { getLeadingEmoji, uuid } from '@renderer/utils'
import { Button, Form, FormInstance, Input, Modal, Popover, Select, SelectProps } from 'antd'
import TextArea from 'antd/es/input/TextArea'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import stringWidth from 'string-width'
import styled from 'styled-components'

interface Props {
  resolve: (data: Agent | null) => void
}

type FieldType = {
  id: string
  name: string
  prompt: string
  knowledge_base_ids: string[]
}

const logger = loggerService.withContext('AddAgentPopup')

const PopupContainer: React.FC<Props> = ({ resolve }) => {
  const [open, setOpen] = useState(true)
  const [form] = Form.useForm()
  const { t } = useTranslation()
  const { addAgent } = useAgents()
  const formRef = useRef<FormInstance>(null)
  const [emoji, setEmoji] = useState('')
  const [loading, setLoading] = useState(false)
  const [showUndoButton, setShowUndoButton] = useState(false)
  const [originalPrompt, setOriginalPrompt] = useState('')
  const [tokenCount, setTokenCount] = useState(0)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const knowledgeState = useAppSelector((state) => state.knowledge)
  const showKnowledgeIcon = useSidebarIconShow('knowledge')
  const knowledgeOptions: SelectProps['options'] = []

  knowledgeState.bases.forEach((base) => {
    knowledgeOptions.push({
      label: base.name,
      value: base.id
    })
  })

  useEffect(() => {
    const updateTokenCount = async () => {
      const prompt = formRef.current?.getFieldValue('prompt')
      if (prompt) {
        const count = await estimateTextTokens(prompt)
        setTokenCount(count)
      } else {
        setTokenCount(0)
      }
    }
    updateTokenCount()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.getFieldValue('prompt')])

  const onFinish = (values: FieldType) => {
    const _emoji = emoji || getLeadingEmoji(values.name)

    if (values.name.trim() === '' || values.prompt.trim() === '') {
      return
    }

    const _agent: Agent = {
      id: uuid(),
      name: values.name,
      knowledge_bases: values.knowledge_base_ids
        ?.map((id) => knowledgeState.bases.find((t) => t.id === id))
        ?.filter((base): base is KnowledgeBase => base !== undefined),
      emoji: _emoji,
      prompt: values.prompt,
      defaultModel: getDefaultModel(),
      type: 'agent',
      topics: [],
      messages: []
    }

    addAgent(_agent)
    resolve(_agent)
    setOpen(false)
  }

  const handleCancel = () => {
    if (hasUnsavedChanges) {
      window.modal.confirm({
        title: t('common.confirm'),
        content: t('agents.add.unsaved_changes_warning'),
        okText: t('common.confirm'),
        cancelText: t('common.cancel'),
        centered: true,
        onOk: () => {
          setOpen(false)
        }
      })
    } else {
      setOpen(false)
    }
  }

  const onClose = () => {
    resolve(null)
  }

  const handleGenerateButtonClick = async () => {
    const name = formRef.current?.getFieldValue('name')
    const content = formRef.current?.getFieldValue('prompt')
    const promptText = content || name

    if (!promptText) {
      return
    }

    if (content) {
      navigator.clipboard.writeText(content)
    }

    setLoading(true)
    setShowUndoButton(false)

    try {
      const generatedText = await fetchGenerate({
        prompt: AGENT_PROMPT,
        content: promptText
      })
      form.setFieldsValue({ prompt: generatedText })
      setShowUndoButton(true)
      setOriginalPrompt(content)
      setHasUnsavedChanges(true)
    } catch (error) {
      logger.error('Error fetching data:', error as Error)
    }

    setLoading(false)
  }

  const handleUndoButtonClick = async () => {
    form.setFieldsValue({ prompt: originalPrompt })
    setShowUndoButton(false)
  }

  // Compute label width based on the longest label
  const labelWidth = [t('agents.add.name.label'), t('agents.add.prompt.label'), t('agents.add.knowledge_base.label')]
    .map((labelText) => stringWidth(labelText) * 8)
    .reduce((maxWidth, currentWidth) => Math.max(maxWidth, currentWidth), 80)

  return (
    <Modal
      title={t('agents.add.title')}
      open={open}
      onOk={() => formRef.current?.submit()}
      onCancel={handleCancel}
      maskClosable={false}
      afterClose={onClose}
      okText={t('agents.add.title')}
      width={600}
      transitionName="animation-move-down"
      centered>
      <Form
        ref={formRef}
        form={form}
        labelCol={{ flex: `${labelWidth}px` }}
        labelAlign="left"
        colon={false}
        style={{ marginTop: 25 }}
        onFinish={onFinish}
        onValuesChange={async (changedValues) => {
          if (changedValues.prompt) {
            const count = await estimateTextTokens(changedValues.prompt)
            setTokenCount(count)
            setShowUndoButton(false)
          }

          const currentValues = form.getFieldsValue()
          setHasUnsavedChanges(currentValues.name?.trim() || currentValues.prompt?.trim() || emoji)
        }}>
        <Form.Item name="name" label="Emoji">
          <Popover
            content={
              <EmojiPicker
                onEmojiClick={(selectedEmoji) => {
                  setEmoji(selectedEmoji)
                  setHasUnsavedChanges(true)
                }}
              />
            }
            arrow>
            <Button icon={emoji && <span style={{ fontSize: 20 }}>{emoji}</span>}>{t('common.select')}</Button>
          </Popover>
        </Form.Item>
        <Form.Item name="name" label={t('agents.add.name.label')} rules={[{ required: true }]}>
          <Input placeholder={t('agents.add.name.placeholder')} spellCheck={false} allowClear />
        </Form.Item>
        <div style={{ position: 'relative' }}>
          <Form.Item
            name="prompt"
            label={t('agents.add.prompt.label')}
            rules={[{ required: true }]}
            style={{ position: 'relative' }}>
            <TextArea placeholder={t('agents.add.prompt.placeholder')} spellCheck={false} rows={10} />
          </Form.Item>
          <TokenCount>Tokens: {tokenCount}</TokenCount>
          <Button
            icon={loading ? <LoadingOutlined /> : <ThunderboltOutlined />}
            onClick={handleGenerateButtonClick}
            style={{ position: 'absolute', top: 8, right: 8 }}
            disabled={loading}
          />
          {showUndoButton && (
            <Button
              icon={<RollbackOutlined />}
              onClick={handleUndoButtonClick}
              style={{ position: 'absolute', top: 8, right: 48 }}
            />
          )}
        </div>
        {showKnowledgeIcon && (
          <Form.Item
            name="knowledge_base_ids"
            label={t('agents.add.knowledge_base.label')}
            rules={[{ required: false }]}>
            <Select
              mode="multiple"
              allowClear
              placeholder={t('agents.add.knowledge_base.placeholder')}
              menuItemSelectedIcon={<CheckOutlined />}
              options={knowledgeOptions}
              filterOption={(input, option) =>
                String(option?.label ?? '')
                  .toLowerCase()
                  .includes(input.toLowerCase())
              }
            />
          </Form.Item>
        )}
      </Form>
    </Modal>
  )
}

const TokenCount = styled.div`
  position: absolute;
  bottom: 8px;
  right: 8px;
  background-color: var(--color-background-soft);
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  color: var(--color-text-2);
  user-select: none;
`

export default class AddAgentPopup {
  static topviewId = 0
  static hide() {
    TopView.hide('AddAgentPopup')
  }
  static show() {
    return new Promise<Agent | null>((resolve) => {
      TopView.show(
        <PopupContainer
          resolve={(v) => {
            resolve(v)
            this.hide()
          }}
        />,
        'AddAgentPopup'
      )
    })
  }
}
