import 'emoji-picker-element'

import { CheckOutlined, LoadingOutlined, ThunderboltOutlined } from '@ant-design/icons'
import EmojiPicker from '@renderer/components/EmojiPicker'
import { TopView } from '@renderer/components/TopView'
import { AGENT_PROMPT } from '@renderer/config/prompts'
import { useAgents } from '@renderer/hooks/useAgents'
import { fetchGenerate } from '@renderer/services/ApiService'
import { getDefaultModel } from '@renderer/services/AssistantService'
import { useAppSelector } from '@renderer/store'
import { Agent } from '@renderer/types'
import { getLeadingEmoji, uuid } from '@renderer/utils'
import { Button, Form, FormInstance, Input, Modal, Popover, Select, SelectProps } from 'antd'
import TextArea from 'antd/es/input/TextArea'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  resolve: (data: Agent | null) => void
}

type FieldType = {
  id: string
  name: string
  prompt: string
  knowledge_base_id: string
}

const PopupContainer: React.FC<Props> = ({ resolve }) => {
  const [open, setOpen] = useState(true)
  const [form] = Form.useForm()
  const { t } = useTranslation()
  const { addAgent } = useAgents()
  const formRef = useRef<FormInstance>(null)
  const [emoji, setEmoji] = useState('')
  const [loading, setLoading] = useState(false)
  const knowledgeState = useAppSelector((state) => state.knowledge)
  const knowledgeOptions: SelectProps['options'] = []

  knowledgeState.bases.forEach((base) => {
    knowledgeOptions.push({
      label: base.name,
      value: base.id
    })
  })

  const onFinish = (values: FieldType) => {
    const _emoji = emoji || getLeadingEmoji(values.name)

    if (values.name.trim() === '' || values.prompt.trim() === '') {
      return
    }

    const _agent: Agent = {
      id: uuid(),
      name: values.name,
      knowledge_base: knowledgeState.bases.find((t) => t.id === values.knowledge_base_id),
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

  const onCancel = () => {
    setOpen(false)
  }

  const onClose = () => {
    resolve(null)
  }

  const handleButtonClick = async () => {
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

    try {
      const generatedText = await fetchGenerate({
        prompt: AGENT_PROMPT,
        content: promptText
      })
      formRef.current?.setFieldValue('prompt', generatedText)
    } catch (error) {
      console.error('Error fetching data:', error)
    }

    setLoading(false)
  }

  return (
    <Modal
      title={t('agents.add.title')}
      open={open}
      onOk={() => formRef.current?.submit()}
      onCancel={onCancel}
      maskClosable={false}
      afterClose={onClose}
      okText={t('agents.add.title')}
      centered>
      <Form
        ref={formRef}
        form={form}
        labelCol={{ flex: '80px' }}
        labelAlign="left"
        colon={false}
        style={{ marginTop: 25 }}
        onFinish={onFinish}>
        <Form.Item name="name" label="Emoji">
          <Popover content={<EmojiPicker onEmojiClick={setEmoji} />} arrow>
            <Button icon={emoji && <span style={{ fontSize: 20 }}>{emoji}</span>}>{t('common.select')}</Button>
          </Popover>
        </Form.Item>
        <Form.Item name="name" label={t('agents.add.name')} rules={[{ required: true }]}>
          <Input placeholder={t('agents.add.name.placeholder')} spellCheck={false} allowClear />
        </Form.Item>
        <div style={{ position: 'relative' }}>
          <Form.Item
            name="prompt"
            label={t('agents.add.prompt')}
            rules={[{ required: true }]}
            style={{ position: 'relative' }}>
            <TextArea placeholder={t('agents.add.prompt.placeholder')} spellCheck={false} rows={10} />
          </Form.Item>
          <Button
            icon={loading ? <LoadingOutlined /> : <ThunderboltOutlined />}
            onClick={handleButtonClick}
            style={{ position: 'absolute', top: 8, right: 8 }}
            disabled={loading}
          />
        </div>
        <Form.Item name="knowledge_base_id" label={t('agents.add.knowledge_base')} rules={[{ required: false }]}>
          <Select
            allowClear
            placeholder={t('agents.add.knowledge_base.placeholder')}
            menuItemSelectedIcon={<CheckOutlined />}
            options={knowledgeOptions}
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}

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
