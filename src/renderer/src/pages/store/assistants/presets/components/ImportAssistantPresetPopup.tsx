import { TopView } from '@renderer/components/TopView'
import { useAssistantPresets } from '@renderer/hooks/useAssistantPresets'
import { useTimer } from '@renderer/hooks/useTimer'
import { getDefaultModel } from '@renderer/services/AssistantService'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { AssistantPreset } from '@renderer/types'
import { uuid } from '@renderer/utils'
import { Button, Flex, Form, Input, Modal, Radio } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  resolve: (value: AssistantPreset[] | null) => void
}

const PopupContainer: React.FC<Props> = ({ resolve }) => {
  const [open, setOpen] = useState(true)
  const [form] = Form.useForm()
  const { t } = useTranslation()
  const { addAssistantPreset } = useAssistantPresets()
  const [importType, setImportType] = useState<'url' | 'file'>('url')
  const [loading, setLoading] = useState(false)
  const { setTimeoutTimer } = useTimer()

  const onFinish = async (values: { url?: string }) => {
    setLoading(true)
    try {
      let presets: AssistantPreset[] = []

      if (importType === 'url') {
        if (!values.url) {
          throw new Error(t('assistants.presets.import.error.url_required'))
        }
        const response = await fetch(values.url)
        if (!response.ok) {
          throw new Error(t('assistants.presets.import.error.fetch_failed'))
        }
        const data = await response.json()
        presets = Array.isArray(data) ? data : [data]
      } else {
        const result = await window.api.file.open({
          filters: [{ name: t('assistants.presets.import.file_filter'), extensions: ['json'] }]
        })

        if (result) {
          presets = JSON.parse(new TextDecoder('utf-8').decode(result.content))
          if (!Array.isArray(presets)) {
            presets = [presets]
          }
        } else {
          return
        }
      }

      // Validate and process agents
      for (const preset of presets) {
        if (!preset.name || !preset.prompt) {
          throw new Error(t('assistants.presets.import.error.invalid_format'))
        }

        const newPreset: AssistantPreset = {
          id: uuid(),
          name: preset.name,
          emoji: preset.emoji || '🤖',
          group: preset.group || [],
          prompt: preset.prompt,
          description: preset.description || '',
          type: 'agent',
          topics: [],
          messages: [],
          defaultModel: getDefaultModel(),
          regularPhrases: preset.regularPhrases || []
        }
        addAssistantPreset(newPreset)
      }

      window.toast.success(t('message.agents.imported'))

      setTimeoutTimer('onFinish', () => EventEmitter.emit(EVENT_NAMES.SHOW_ASSISTANTS), 0)
      setOpen(false)
      resolve(presets)
    } catch (error) {
      window.toast.error(error instanceof Error ? error.message : t('message.agents.import.error'))
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
      title={t('assistants.presets.import.title')}
      open={open}
      onCancel={onCancel}
      maskClosable={false}
      footer={
        <Flex justify="end" gap={8}>
          <Button onClick={onCancel}>{t('common.cancel')}</Button>
          <Button type="primary" onClick={() => form.submit()} loading={loading}>
            {t('assistants.presets.import.button')}
          </Button>
        </Flex>
      }
      transitionName="animation-move-down"
      centered>
      <Form form={form} onFinish={onFinish} layout="vertical">
        <Form.Item>
          <Radio.Group value={importType} onChange={(e) => setImportType(e.target.value)}>
            <Radio.Button value="url">{t('assistants.presets.import.type.url')}</Radio.Button>
            <Radio.Button value="file">{t('assistants.presets.import.type.file')}</Radio.Button>
          </Radio.Group>
        </Form.Item>

        {importType === 'url' && (
          <Form.Item
            name="url"
            rules={[{ required: true, message: t('assistants.presets.import.error.url_required') }]}>
            <Input placeholder={t('assistants.presets.import.url_placeholder')} />
          </Form.Item>
        )}

        {importType === 'file' && (
          <Form.Item>
            <Button onClick={() => form.submit()}>{t('assistants.presets.import.select_file')}</Button>
          </Form.Item>
        )}
      </Form>
    </Modal>
  )
}

export default class ImportAssistantPresetPopup {
  static show() {
    return new Promise<AssistantPreset[] | null>((resolve) => {
      TopView.show(
        <PopupContainer
          resolve={(v) => {
            resolve(v)
            this.hide()
          }}
        />,
        'ImportAssistantPresetPopup'
      )
    })
  }

  static hide() {
    TopView.hide('ImportAssistantPresetPopup')
  }
}
