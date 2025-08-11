import { TopView } from '@renderer/components/TopView'
import { useAgents } from '@renderer/hooks/useAgents'
import { getDefaultModel } from '@renderer/services/AssistantService'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { Agent } from '@renderer/types'
import { uuid } from '@renderer/utils'
import { Button, Flex, Form, Input, Modal, Radio } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  resolve: (value: Agent[] | null) => void
}

const PopupContainer: React.FC<Props> = ({ resolve }) => {
  const [open, setOpen] = useState(true)
  const [form] = Form.useForm()
  const { t } = useTranslation()
  const { addAgent } = useAgents()
  const [importType, setImportType] = useState<'url' | 'file'>('url')
  const [loading, setLoading] = useState(false)

  const onFinish = async (values: { url?: string }) => {
    setLoading(true)
    try {
      let agents: Agent[] = []

      if (importType === 'url') {
        if (!values.url) {
          throw new Error(t('agents.import.error.url_required'))
        }
        const response = await fetch(values.url)
        if (!response.ok) {
          throw new Error(t('agents.import.error.fetch_failed'))
        }
        const data = await response.json()
        agents = Array.isArray(data) ? data : [data]
      } else {
        const result = await window.api.file.open({
          filters: [{ name: t('agents.import.file_filter'), extensions: ['json'] }]
        })

        if (result) {
          agents = JSON.parse(new TextDecoder('utf-8').decode(result.content))
          if (!Array.isArray(agents)) {
            agents = [agents]
          }
        } else {
          return
        }
      }

      // Validate and process agents
      for (const agent of agents) {
        if (!agent.name || !agent.prompt) {
          throw new Error(t('agents.import.error.invalid_format'))
        }

        const newAgent: Agent = {
          id: uuid(),
          name: agent.name,
          emoji: agent.emoji || '🤖',
          group: agent.group || [],
          prompt: agent.prompt,
          description: agent.description || '',
          type: 'agent',
          topics: [],
          messages: [],
          defaultModel: getDefaultModel(),
          regularPhrases: agent.regularPhrases || []
        }
        addAgent(newAgent)
      }

      window.message.success({
        content: t('message.agents.imported'),
        key: 'agents-imported'
      })

      setTimeout(() => EventEmitter.emit(EVENT_NAMES.SHOW_ASSISTANTS), 0)
      setOpen(false)
      resolve(agents)
    } catch (error) {
      window.message.error({
        content: error instanceof Error ? error.message : t('message.agents.import.error'),
        key: 'agents-import-error'
      })
    } finally {
      setLoading(false)
    }
  }

  const onCancel = () => {
    setOpen(false)
    resolve(null)
  }

  return (
    <Modal
      title={t('agents.import.title')}
      open={open}
      onCancel={onCancel}
      maskClosable={false}
      footer={
        <Flex justify="end" gap={8}>
          <Button onClick={onCancel}>{t('common.cancel')}</Button>
          <Button type="primary" onClick={() => form.submit()} loading={loading}>
            {t('agents.import.button')}
          </Button>
        </Flex>
      }
      transitionName="animation-move-down"
      centered>
      <Form form={form} onFinish={onFinish} layout="vertical">
        <Form.Item>
          <Radio.Group value={importType} onChange={(e) => setImportType(e.target.value)}>
            <Radio.Button value="url">{t('agents.import.type.url')}</Radio.Button>
            <Radio.Button value="file">{t('agents.import.type.file')}</Radio.Button>
          </Radio.Group>
        </Form.Item>

        {importType === 'url' && (
          <Form.Item name="url" rules={[{ required: true, message: t('agents.import.error.url_required') }]}>
            <Input placeholder={t('agents.import.url_placeholder')} />
          </Form.Item>
        )}

        {importType === 'file' && (
          <Form.Item>
            <Button onClick={() => form.submit()}>{t('agents.import.select_file')}</Button>
          </Form.Item>
        )}
      </Form>
    </Modal>
  )
}

export default class ImportAgentPopup {
  static show() {
    return new Promise<Agent[] | null>((resolve) => {
      TopView.show(
        <PopupContainer
          resolve={(v) => {
            resolve(v)
            this.hide()
          }}
        />,
        'ImportAgentPopup'
      )
    })
  }

  static hide() {
    TopView.hide('ImportAgentPopup')
  }
}
