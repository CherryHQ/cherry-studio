import AiProvider from '@renderer/aiCore'
import { isEmbeddingModel, isRerankModel } from '@renderer/config/models'
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

const MemoriesSettingsModal: FC<MemoriesSettingsModalProps> = ({ visible, onSubmit, onCancel, form }) => {
  const { providers } = useProviders()
  const dispatch = useDispatch()
  const memoryConfig = useSelector(selectMemoryConfig)
  const [autoDims, setAutoDims] = useState(true)
  const [loading, setLoading] = useState(false)

  // Get all models for lookup
  const allModels = providers.flatMap((p) => p.models)

  // Initialize form with current memory config when modal opens
  useEffect(() => {
    if (visible && memoryConfig) {
      // Set autoDims based on whether dimensions are stored
      const hasStoredDimensions = memoryConfig.embedderDimensions !== undefined
      setAutoDims(!hasStoredDimensions)

      form.setFieldsValue({
        llmModel: memoryConfig.llmModel ? getModelUniqId(memoryConfig.llmModel) : undefined,
        embedderModel: memoryConfig.embedderModel ? getModelUniqId(memoryConfig.embedderModel) : undefined,
        embedderDimensions: memoryConfig.embedderDimensions,
        autoDims: !hasStoredDimensions
        // customFactExtractionPrompt: memoryConfig.customFactExtractionPrompt,
        // customUpdateMemoryPrompt: memoryConfig.customUpdateMemoryPrompt
      })
    }
  }, [visible, memoryConfig, form])

  const handleFormSubmit = async (values: any) => {
    try {
      // Convert model IDs back to Model objects
      const llmModel = values.llmModel ? allModels.find((m) => getModelUniqId(m) === values.llmModel) : undefined
      const embedderModel = values.embedderModel
        ? allModels.find((m) => getModelUniqId(m) === values.embedderModel)
        : undefined

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
          llmModel,
          embedderModel,
          embedderDimensions: finalDimensions
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
        .filter((model) => !isEmbeddingModel(model) && p.type === 'openai')
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
      title="Memory Settings"
      open={visible}
      onOk={form.submit}
      onCancel={onCancel}
      width={600}
      confirmLoading={loading}>
      <Form form={form} layout="vertical" onFinish={handleFormSubmit}>
        <Form.Item
          label="LLM Model"
          name="llmModel"
          rules={[{ required: true, message: 'Please select an LLM model' }]}>
          <Select placeholder="Select LLM Model" options={llmSelectOptions} />
        </Form.Item>
        <Form.Item
          label="Embedding Model"
          name="embedderModel"
          rules={[{ required: true, message: 'Please select an embedding model' }]}>
          <Select placeholder="Select Embedding Model" options={embeddingSelectOptions} />
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
            label="Embedding Dimensions"
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
