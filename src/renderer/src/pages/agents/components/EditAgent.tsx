import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import EmojiPicker from '@renderer/components/EmojiPicker'
import { HStack } from '@renderer/components/Layout'
import SelectModelPopup from '@renderer/components/Popups/SelectModelPopup'
import { useAgents } from '@renderer/hooks/useAgents'
import { syncAgentToAssistant } from '@renderer/services/assistant'
import { Agent, AgentMessage } from '@renderer/types'
import { getLeadingEmoji } from '@renderer/utils'
import { Button, Card, Col, Divider, Form, FormInstance, Input, Popover, Row, Switch } from 'antd'
import TextArea from 'antd/es/input/TextArea'
import { FC, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

type FieldType = {
  id: string
  name: string
  prompt: string
}

interface Props {
  agent: Agent
  onClose: () => void
}

const EditAgent: FC<Props> = ({ agent, onClose }) => {
  const { t } = useTranslation()
  const [form] = Form.useForm()
  const formRef = useRef<FormInstance>(null)
  const { updateAgent } = useAgents()
  const [emoji, setEmoji] = useState(agent?.emoji)
  const [messages, setMessagess] = useState<AgentMessage[]>(agent?.messages || [])
  const [model, setModel] = useState(agent?.model)
  const [hideMessages, setHideMessages] = useState(agent?.hideMessages)

  const onFinish = (values: FieldType) => {
    const _emoji = emoji || getLeadingEmoji(values.name)

    if (values.name.trim() === '' || values.prompt.trim() === '') {
      return
    }

    // 检查是否有空对话组
    for (let i = 0; i < messages.length; i += 2) {
      const userContent = messages[i].content.trim()
      const assistantContent = messages[i + 1]?.content.trim()
      if (userContent === '' || assistantContent === '') {
        window.modal.error({
          centered: true,
          content: t('agents.edit.message.empty.content')
        })
        return
      }
    }

    // 过滤掉空消息并将消息分组
    const filteredMessagess = messages.reduce((acc, conv, index) => {
      if (index % 2 === 0) {
        const userContent = conv.content.trim()
        const assistantContent = messages[index + 1]?.content.trim()
        if (userContent !== '' || assistantContent !== '') {
          acc.push({ role: 'user', content: userContent }, { role: 'assistant', content: assistantContent })
        }
      }
      return acc
    }, [] as AgentMessage[])

    const _agent = {
      ...agent,
      name: values.name,
      emoji: _emoji,
      prompt: values.prompt,
      model,
      messages: filteredMessagess,
      hideMessages
    } as Agent

    updateAgent(_agent)
    syncAgentToAssistant(_agent)

    onClose()
  }

  const addMessages = () => {
    setMessagess([...messages, { role: 'user', content: '' }, { role: 'assistant', content: '' }])
  }

  const updateMessages = (index: number, role: 'user' | 'assistant', content: string) => {
    const newMessagess = [...messages]
    newMessagess[index] = { role, content }
    setMessagess(newMessagess)
  }

  const deleteMessages = (index: number) => {
    const newMessagess = [...messages]
    newMessagess.splice(index, 2) // 删除用户和助手的对话
    setMessagess(newMessagess)
  }

  const onSelectModel = async () => {
    const selectedModel = await SelectModelPopup.show({ model: agent?.model })
    if (selectedModel) {
      setModel(selectedModel)
    }
  }

  useEffect(() => {
    if (agent) {
      form.setFieldsValue({
        name: agent.name,
        prompt: agent.prompt
      })
    }
  }, [agent, form])

  return (
    <Container>
      <Form ref={formRef} form={form} labelAlign="right" labelCol={{ span: 2 }} colon={false} onFinish={onFinish}>
        <Form.Item name="emoji" label="Emoji">
          <Popover content={<EmojiPicker onEmojiClick={setEmoji} />} arrow placement="rightBottom">
            <Button icon={emoji && <span style={{ fontSize: 20 }}>{emoji}</span>}>{t('common.select')}</Button>
          </Popover>
        </Form.Item>
        <Form.Item name="name" label={t('agents.add.name')} rules={[{ required: true }]}>
          <Input placeholder={t('agents.add.name.placeholder')} spellCheck={false} allowClear />
        </Form.Item>
        <Form.Item name="prompt" label={t('agents.add.prompt')} rules={[{ required: true }]}>
          <TextArea placeholder={t('agents.add.prompt.placeholder')} spellCheck={false} rows={4} />
        </Form.Item>
        <Form.Item name="model" label={t('common.model')}>
          <HStack alignItems="center">
            <Button icon={model ? <ModelAvatar model={model} size={20} /> : <PlusOutlined />} onClick={onSelectModel}>
              {model ? model.name : t('agents.edit.model.select.title')}
            </Button>
            {model && <RemoveIcon onClick={() => setModel(undefined)} />}
          </HStack>
        </Form.Item>
        <Form.Item label={t('agents.edit.message.title')}>
          {messages.map(
            (_, index) =>
              index % 2 === 0 && (
                <Card
                  size="small"
                  key={index}
                  style={{ marginBottom: 16 }}
                  title={`${t('agents.edit.message.group.title')} #${index / 2 + 1}`}
                  extra={<Button icon={<DeleteOutlined />} type="text" danger onClick={() => deleteMessages(index)} />}>
                  <Row gutter={16} align="middle" style={{ marginBottom: 16 }}>
                    <Col span={2}>
                      <label>{t('agents.edit.message.user.title')}</label>
                    </Col>
                    <Col span={22}>
                      <Input
                        value={messages[index].content}
                        onChange={(e) => updateMessages(index, 'user', e.target.value)}
                        placeholder={t('agents.edit.message.user.placeholder')}
                      />
                    </Col>
                  </Row>
                  <Row gutter={16} align="top">
                    <Col span={2}>
                      <label>{t('agents.edit.message.assistant.title')}</label>
                    </Col>
                    <Col span={22}>
                      <TextArea
                        value={messages[index + 1]?.content || ''}
                        onChange={(e) => updateMessages(index + 1, 'assistant', e.target.value)}
                        placeholder={t('agents.edit.message.assistant.placeholder')}
                        rows={3}
                      />
                    </Col>
                  </Row>
                </Card>
              )
          )}
          <Button icon={<PlusOutlined />} onClick={addMessages}>
            {t('agents.edit.message.add.title')}
          </Button>
        </Form.Item>
        {messages.length > 0 && (
          <Form.Item label={t('agents.edit.settings.hide_preset_messages')}>
            <Switch checked={hideMessages} onChange={(checked) => setHideMessages(checked)} />
          </Form.Item>
        )}
        <Divider />
        <Form.Item>
          <HStack justifyContent="flex-end" gap="10px">
            <Button danger type="link" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="primary" htmlType="submit">
              {t('common.save')}
            </Button>
          </HStack>
        </Form.Item>
      </Form>
      <div style={{ minHeight: 50 }} />
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  height: 100%;
  padding: 20px;
  overflow-y: scroll;
`

const RemoveIcon = styled(DeleteOutlined)`
  font-size: 16px;
  margin-left: 10px;
  color: var(--color-error);
  cursor: pointer;
  transition: all 0.2s ease-in-out;
`

export default EditAgent
