import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import { Assistant, AssistantMessage, AssistantSettings } from '@renderer/types'
import { Button, Card, Col, Divider, Form as FormAntd, FormInstance, Row, Space, Switch } from 'antd'
import TextArea from 'antd/es/input/TextArea'
import { FC, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  assistant: Assistant
  updateAssistant: (assistant: Assistant) => void
  updateAssistantSettings: (settings: Partial<AssistantSettings>) => void
}

const AssistantMessagesSettings: FC<Props> = ({ assistant, updateAssistant, updateAssistantSettings }) => {
  const { t } = useTranslation()
  const [form] = Form.useForm()
  const formRef = useRef<FormInstance>(null)
  const [messages, setMessagess] = useState<AssistantMessage[]>(assistant?.messages || [])
  const [hideMessages, setHideMessages] = useState(assistant?.settings?.hideMessages || false)

  const showSaveButton = (assistant?.messages || []).length !== messages.length

  const onSave = () => {
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
    }, [] as AssistantMessage[])

    updateAssistant({
      ...assistant,
      messages: filteredMessagess
    })

    window.message.success({ content: t('message.save.success.title'), key: 'save-messages' })
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

  return (
    <Container>
      <Form ref={formRef} layout="vertical" form={form} labelAlign="right" colon={false}>
        <Form.Item label={t('agents.edit.settings.hide_preset_messages')}>
          <Switch
            checked={hideMessages}
            onChange={(checked) => {
              setHideMessages(checked)
              updateAssistantSettings({ hideMessages: checked })
            }}
          />
        </Form.Item>
        <Divider style={{ marginBottom: 15 }} />
        <Form.Item label={t('agents.edit.message.group.title')}>
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
                    <Col span={3}>
                      <label>{t('agents.edit.message.user.title')}</label>
                    </Col>
                    <Col span={21}>
                      <TextArea
                        value={messages[index].content}
                        onChange={(e) => updateMessages(index, 'user', e.target.value)}
                        placeholder={t('agents.edit.message.user.placeholder')}
                        spellCheck={false}
                        rows={1}
                      />
                    </Col>
                  </Row>
                  <Row gutter={16} align="top">
                    <Col span={3}>
                      <label>{t('agents.edit.message.assistant.title')}</label>
                    </Col>
                    <Col span={21}>
                      <TextArea
                        value={messages[index + 1]?.content || ''}
                        onChange={(e) => updateMessages(index + 1, 'assistant', e.target.value)}
                        placeholder={t('agents.edit.message.assistant.placeholder')}
                        spellCheck={false}
                        rows={3}
                      />
                    </Col>
                  </Row>
                </Card>
              )
          )}
          <Space>
            <Button icon={<PlusOutlined />} onClick={addMessages}>
              {t('agents.edit.message.add.title')}
            </Button>
          </Space>
        </Form.Item>
        <Divider style={{ marginBottom: 15 }} />
        <Form.Item>
          {showSaveButton && (
            <Button type="primary" onClick={onSave}>
              {t('common.save')}
            </Button>
          )}
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
  padding-top: 10px;
`

const Form = styled(FormAntd)`
  .ant-form-item-no-colon {
    font-weight: 500;
  }
`

export default AssistantMessagesSettings
