import AiProvider from '@renderer/aiCore'
import { isEmbeddingModel, isRerankModel } from '@renderer/config/models'
import { useModel } from '@renderer/hooks/useModel'
import { useProviders } from '@renderer/hooks/useProvider'
import { getModelUniqId } from '@renderer/services/ModelService'
import { selectMemoryConfig, updateMemoryConfig } from '@renderer/store/memory'
import { getErrorMessage } from '@renderer/utils/error'
import { Form, InputNumber, Modal, Select, Switch } from 'antd'
import { t } from 'i18next'
import { sortBy } from 'lodash'
import { FC, useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'

interface MemoriesSettingsModalProps {
  visible: boolean
  onSubmit: (values: any) => void
  onCancel: () => void
  form: any
}

type formValue = {
  llmModel: string
  embedderModel: string
  embedderDimensions: number
  autoDims: boolean
}

const MemoriesSettingsModal: FC<MemoriesSettingsModalProps> = ({ visible, onSubmit, onCancel, form }) => {
  const { providers } = useProviders()
  const dispatch = useDispatch()
  const memoryConfig = useSelector(selectMemoryConfig)
  const [autoDims, setAutoDims] = useState(true)
  const [loading, setLoading] = useState(false)

  // Get all models for lookup
  const allModels = providers.flatMap((p) => p.models)
  const llmModel = useModel(memoryConfig.llmApiClient?.model, memoryConfig.llmApiClient?.provider)
  const embedderModel = useModel(memoryConfig.embedderApiClient?.model, memoryConfig.embedderApiClient?.provider)

  // Initialize form with current memory config when modal opens
  useEffect(() => {
    if (visible && memoryConfig) {
      // Use isAutoDimensions to determine autoDims state, defaulting to true if not set
      const isAutoDims = memoryConfig.isAutoDimensions !== false
      setAutoDims(isAutoDims)

      form.setFieldsValue({
        llmModel: getModelUniqId(llmModel),
        embedderModel: getModelUniqId(embedderModel),
        embedderDimensions: memoryConfig.embedderDimensions,
        autoDims: isAutoDims
        // customFactExtractionPrompt: memoryConfig.customFactExtractionPrompt,
        // customUpdateMemoryPrompt: memoryConfig.customUpdateMemoryPrompt
      })
    }
  }, [visible, memoryConfig, form, llmModel, embedderModel])

  const handleFormSubmit = async (values: formValue) => {
    try {
      // Convert model IDs back to Model objects
      const llmModel = values.llmModel ? allModels.find((m) => getModelUniqId(m) === values.llmModel) : undefined
      const llmProvider = providers.find((p) => p.id === llmModel?.provider)
      const aiLlmProvider = new AiProvider(llmProvider!)
      const embedderModel = values.embedderModel
        ? allModels.find((m) => getModelUniqId(m) === values.embedderModel)
        : undefined
      const embedderProvider = providers.find((p) => p.id === embedderModel?.provider)
      const aiEmbedderProvider = new AiProvider(embedderProvider!)
      if (embedderModel) {
        setLoading(true)
        const provider = providers.find((p) => p.id === embedderModel.provider)

        if (!provider) {
          return
        }

        let finalDimensions: number | undefined

        // Auto-detect dimensions if autoDims is enabled or dimensions not provided
        if (values.autoDims || values.embedderDimensions === undefined) {
          try {
            const aiProvider = new AiProvider(provider)
            finalDimensions = await aiProvider.getEmbeddingDimensions(embedderModel)
          } catch (error) {
            console.error('Error getting embedding dimensions:', error)
            window.message.error(t('message.error.get_embedding_dimensions') + '\n' + getErrorMessage(error))
            setLoading(false)
            return
          }
        } else {
          finalDimensions =
            typeof values.embedderDimensions === 'string'
              ? parseInt(values.embedderDimensions)
              : values.embedderDimensions
        }

        const updatedConfig = {
          ...memoryConfig,
          llmApiClient: {
            model: llmModel?.id ?? '',
            provider: llmProvider?.id ?? '',
            apiKey: aiLlmProvider.getApiKey(),
            baseURL: aiLlmProvider.getBaseURL(),
            apiVersion: llmProvider?.apiVersion
          },
          embedderApiClient: {
            model: embedderModel?.id ?? '',
            provider: embedderProvider?.id ?? '',
            apiKey: aiEmbedderProvider.getApiKey(),
            baseURL: aiEmbedderProvider.getBaseURL(),
            apiVersion: embedderProvider?.apiVersion
          },
          embedderDimensions: finalDimensions,
          isAutoDimensions: values.autoDims
          // customFactExtractionPrompt: values.customFactExtractionPrompt,
          // customUpdateMemoryPrompt: values.customUpdateMemoryPrompt
        }

        dispatch(updateMemoryConfig(updatedConfig))
        onSubmit(updatedConfig)
        setLoading(false)
      }
    } catch (error) {
      console.error('Error submitting form:', error)
      setLoading(false)
    }
  }

  const llmSelectOptions = providers
    .filter((p) => p.models.length > 0)
    .map((p) => ({
      label: p.isSystem ? t(`provider.${p.id}`) : p.name,
      title: p.name,
      options: sortBy(p.models, 'name')
        .filter((model) => !isEmbeddingModel(model) && !isRerankModel(model))
        .map((m) => ({
          label: m.name,
          value: getModelUniqId(m)
        }))
    }))
    .filter((group) => group.options.length > 0)

  const embeddingSelectOptions = providers
    .filter((p) => p.models.length > 0)
    .map((p) => ({
      label: p.isSystem ? t(`provider.${p.id}`) : p.name,
      title: p.name,
      options: sortBy(p.models, 'name')
        .filter((model) => isEmbeddingModel(model) && !isRerankModel(model))
        .map((m) => ({
          label: m.name,
          value: getModelUniqId(m)
        }))
    }))
    .filter((group) => group.options.length > 0)

  return (
    <Modal
      title={t('memory.settings_title')}
      open={visible}
      onOk={form.submit}
      onCancel={onCancel}
      width={600}
      centered
      transitionName="animation-move-down"
      confirmLoading={loading}
      styles={{
        header: {
          borderBottom: '0.5px solid var(--color-border)',
          paddingBottom: 16,
          borderBottomLeftRadius: 0,
          borderBottomRightRadius: 0
        },
        body: {
          paddingTop: 24
        }
      }}>
      <Form form={form} layout="vertical" onFinish={handleFormSubmit}>
        <Form.Item
          label={t('memory.llm_model')}
          name="llmModel"
          rules={[{ required: true, message: t('memory.please_select_llm_model') }]}>
          <Select placeholder={t('memory.select_llm_model_placeholder')} options={llmSelectOptions} showSearch />
        </Form.Item>
        <Form.Item
          label={t('memory.embedding_model')}
          name="embedderModel"
          rules={[{ required: true, message: t('memory.please_select_embedding_model') }]}>
          <Select placeholder={t('memory.select_embedding_model_placeholder')} options={embeddingSelectOptions} />
        </Form.Item>
        <Form.Item
          label={t('knowledge.dimensions_auto_set')}
          name="autoDims"
          tooltip={{ title: t('knowledge.dimensions_default') }}
          valuePropName="checked">
          <Switch
            checked={autoDims}
            onChange={(checked) => {
              setAutoDims(checked)
              form.setFieldValue('autoDims', checked)
              if (checked) {
                form.setFieldValue('embedderDimensions', undefined)
              }
            }}
          />
        </Form.Item>

        {!autoDims && (
          <Form.Item
            label={t('memory.embedding_dimensions')}
            name="embedderDimensions"
            rules={[
              {
                validator(_, value) {
                  if (form.getFieldValue('autoDims') || value > 0) {
                    return Promise.resolve()
                  }
                  return Promise.reject(new Error(t('knowledge.dimensions_error_invalid')))
                }
              }
            ]}>
            <InputNumber style={{ width: '100%' }} min={1} placeholder={t('knowledge.dimensions_size_placeholder')} />
          </Form.Item>
        )}
        {/* <Form.Item label="Custom Fact Extraction Prompt" name="customFactExtractionPrompt">
          <Input.TextArea placeholder="Optional custom prompt for fact extraction..." rows={3} />
        </Form.Item>
        <Form.Item label="Custom Update Memory Prompt" name="customUpdateMemoryPrompt">
          <Input.TextArea placeholder="Optional custom prompt for memory updates..." rows={3} />
        </Form.Item> */}
      </Form>
    </Modal>
  )
}

export default MemoriesSettingsModal
