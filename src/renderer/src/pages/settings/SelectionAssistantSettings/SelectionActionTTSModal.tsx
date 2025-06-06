import type { ActionItem } from '@renderer/types/selectionTypes'
import { useTTS } from '@renderer/hooks/useTTS'
import { Form, Modal, Select } from 'antd'
import { Volume2, VolumeX } from 'lucide-react'
import { FC, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

interface TTSProviderOption {
  label: string
  value: string
  ttsProvider: string
  icon: React.ReactNode
  enabled: boolean
}

interface SelectionActionTTSModalProps {
  isModalOpen: boolean
  onOk: (ttsProvider: string) => void
  onCancel: () => void
  currentAction?: ActionItem
}

const SelectionActionTTSModal: FC<SelectionActionTTSModalProps> = ({
  isModalOpen,
  onOk,
  onCancel,
  currentAction
}) => {
  const { t } = useTranslation()
  const { providers } = useTTS()
  const [form] = Form.useForm()

  // 构建 TTS 供应商选项
  const ttsProviderOptions: TTSProviderOption[] = [
    {
      label: t('settings.tts.provider.default'),
      value: 'default',
      ttsProvider: 'Default|default',
      icon: <Volume2 size={14} color="var(--color-text-2)" />,
      enabled: true
    },
    ...providers.map(provider => ({
      label: provider.name,
      value: provider.id,
      ttsProvider: `${provider.name}|${provider.id}`,
      icon: provider.enabled ?
        <Volume2 size={14} color="var(--color-text-2)" /> :
        <VolumeX size={14} color="var(--color-text-3)" />,
      enabled: provider.enabled
    }))
  ]

  useEffect(() => {
    if (isModalOpen && currentAction?.ttsProvider) {
      form.resetFields()

      const [, providerId] = currentAction.ttsProvider.split('|')
      const selectedProvider = ttsProviderOptions.find((p) => p.value === providerId)

      if (selectedProvider) {
        form.setFieldsValue({
          provider: selectedProvider.value
        })
      } else {
        // 默认选择第一个可用的供应商
        form.setFieldsValue({
          provider: 'default'
        })
      }
    }
  }, [isModalOpen, currentAction, form, ttsProviderOptions])

  const handleOk = async () => {
    try {
      const values = await form.validateFields()
      const selectedProvider = ttsProviderOptions.find((p) => p.value === values.provider)

      const ttsProvider = selectedProvider?.ttsProvider || 'Default|default'
      onOk(ttsProvider)
    } catch (error) {
      console.error('Validation failed:', error)
    }
  }

  const handleCancel = () => {
    onCancel()
  }



  return (
    <Modal
      title={t('selection.settings.tts_modal.title')}
      open={isModalOpen}
      onOk={handleOk}
      onCancel={handleCancel}
      destroyOnClose
      centered>
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          provider: 'default'
        }}>
        <Form.Item name="provider" label={t('selection.settings.tts_modal.provider.label')}>
          <Select
            options={ttsProviderOptions.map((provider) => ({
              label: (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  opacity: provider.enabled ? 1 : 0.5
                }}>
                  {provider.icon}
                  <span>{provider.label}</span>
                  {!provider.enabled && provider.value !== 'default' && (
                    <span style={{ fontSize: '12px', color: 'var(--color-text-3)' }}>
                      ({t('settings.tts.provider.disabled')})
                    </span>
                  )}
                </div>
              ),
              value: provider.value,
              disabled: !provider.enabled && provider.value !== 'default'
            }))}
          />
        </Form.Item>


      </Form>
    </Modal>
  )
}

export default SelectionActionTTSModal
