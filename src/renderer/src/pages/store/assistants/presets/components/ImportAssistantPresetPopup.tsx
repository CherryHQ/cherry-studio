import { TopView } from '@renderer/components/TopView'
import { useAssistantPresets } from '@renderer/hooks/useAssistantPresets'
import { useSettings } from '@renderer/hooks/useSettings'
import { useTimer } from '@renderer/hooks/useTimer'
import { getDefaultModel } from '@renderer/services/AssistantService'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { useAppDispatch } from '@renderer/store'
import { setAgentssubscribeUrl } from '@renderer/store/settings'
import type { AssistantPreset } from '@renderer/types'
import { uuid } from '@renderer/utils'
import { Button, Divider, Flex, Form, Input, Modal, Radio, Typography } from 'antd'
import { HelpCircle } from 'lucide-react'
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
  const [subscribeLoading, setSubscribeLoading] = useState(false)
  const { setTimeoutTimer } = useTimer()
  const dispatch = useAppDispatch()
  const { agentssubscribeUrl } = useSettings()
  const [subscribeUrl, setSubscribeUrl] = useState(agentssubscribeUrl || '')
  const [selectedFile, setSelectedFile] = useState<{ name: string; content: Uint8Array } | null>(null)
  const [urlValue, setUrlValue] = useState('')

  const isImportDisabled = importType === 'url' ? !urlValue.trim() : !selectedFile
  const isSubscribed = !!agentssubscribeUrl

  const handleSelectFile = async () => {
    const result = await window.api.file.open({
      filters: [{ name: t('assistants.presets.import.file_filter'), extensions: ['json'] }]
    })

    if (result) {
      setSelectedFile({ name: result.fileName, content: result.content })
    }
  }

  const onFinish = async () => {
    // Validate before setting loading
    if (importType === 'url' && !urlValue.trim()) {
      window.toast.error(t('assistants.presets.import.error.url_required'))
      return
    }
    if (importType === 'file' && !selectedFile) {
      window.toast.error(t('assistants.presets.import.error.file_required'))
      return
    }

    setLoading(true)
    try {
      let presets: AssistantPreset[] = []

      if (importType === 'url') {
        const response = await fetch(urlValue.trim())
        if (!response.ok) {
          throw new Error(t('assistants.presets.import.error.fetch_failed'))
        }
        const data = await response.json()
        presets = Array.isArray(data) ? data : [data]
      } else {
        presets = JSON.parse(new TextDecoder('utf-8').decode(selectedFile!.content))
        if (!Array.isArray(presets)) {
          presets = [presets]
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

      window.toast.success(t('message.agents.imported', { count: presets.length }))

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
  }

  const handleSubscribeUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSubscribeUrl(e.target.value)
  }

  const handleSubscribe = async () => {
    // If already subscribed, unsubscribe
    if (isSubscribed) {
      dispatch(setAgentssubscribeUrl(''))
      setSubscribeUrl('')
      window.location.reload()
      return
    }

    if (!subscribeUrl.trim()) {
      return
    }

    setSubscribeLoading(true)
    try {
      const response = await fetch(subscribeUrl)
      if (!response.ok) {
        throw new Error(t('assistants.presets.import.error.fetch_failed'))
      }
      dispatch(setAgentssubscribeUrl(subscribeUrl))
      window.location.reload()
    } catch (error) {
      window.toast.error(error instanceof Error ? error.message : t('message.agents.import.error'))
    } finally {
      setSubscribeLoading(false)
    }
  }

  const handleHelpClick = () => {
    window.open('https://docs.cherry-ai.com/data-settings/assistants-subscribe', '_blank')
  }

  return (
    <Modal
      title={t('assistants.presets.import.title')}
      open={open}
      onCancel={onCancel}
      afterClose={() => resolve(null)}
      footer={null}
      transitionName="animation-move-down"
      styles={{ body: { padding: '16px' } }}
      centered>
      <Form form={form} onFinish={onFinish} layout="vertical">
        <Form.Item style={{ marginBottom: 0 }}>
          <Flex align="center" gap={12} style={{ width: '100%' }}>
            <Radio.Group value={importType} onChange={(e) => setImportType(e.target.value)}>
              <Radio.Button value="url">{t('assistants.presets.import.type.url')}</Radio.Button>
              <Radio.Button value="file">{t('assistants.presets.import.type.file')}</Radio.Button>
            </Radio.Group>

            {importType === 'url' && (
              <Form.Item
                name="url"
                rules={[{ required: true, message: t('assistants.presets.import.error.url_required') }]}
                style={{ flex: 1, marginBottom: 0 }}>
                <Input
                  placeholder={t('assistants.presets.import.url_placeholder')}
                  value={urlValue}
                  onChange={(e) => setUrlValue(e.target.value)}
                />
              </Form.Item>
            )}

            {importType === 'file' && (
              <>
                <Button onClick={handleSelectFile}>{t('assistants.presets.import.select_file')}</Button>
                {selectedFile && (
                  <Typography.Text type="secondary" ellipsis style={{ maxWidth: 200 }}>
                    {selectedFile.name}
                  </Typography.Text>
                )}
                <div style={{ flex: 1 }} />
              </>
            )}

            <Button type="primary" onClick={onFinish} loading={loading} disabled={isImportDisabled}>
              {t('assistants.presets.import.button')}
            </Button>
          </Flex>
        </Form.Item>
      </Form>

      <Divider style={{ margin: '16px 0' }} />

      <Flex align="center" gap={4}>
        <Typography.Text strong style={{ flexShrink: 0, fontSize: 16 }}>
          {t('assistants.presets.tag.agent')}
          {t('settings.tool.websearch.subscribe_add')}
        </Typography.Text>
        <HelpCircle
          size={16}
          color="var(--color-icon)"
          onClick={handleHelpClick}
          className="hover:!text-[var(--color-primary)] cursor-pointer transition-colors"
          style={{ flexShrink: 0 }}
        />
      </Flex>

      <Flex align="center" gap={12} style={{ marginTop: 10 }}>
        <Input
          type="text"
          value={subscribeUrl}
          onChange={handleSubscribeUrlChange}
          style={{ flex: 1 }}
          placeholder={t('settings.tool.websearch.subscribe_url')}
        />
        <Button type="primary" onClick={handleSubscribe} loading={subscribeLoading} disabled={!subscribeUrl.trim()}>
          {isSubscribed ? t('common.unsubscribe') : t('common.subscribe')}
        </Button>
      </Flex>
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
