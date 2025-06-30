import { isEmbeddingModel, isRerankModel } from '@renderer/config/models'
import { useProviders } from '@renderer/hooks/useProvider'
import { getModelUniqId } from '@renderer/services/ModelService'
import { selectMemoryConfig, updateMemoryConfig } from '@renderer/store/memory'
import { Form, Input, Modal, Select } from 'antd'
import { t } from 'i18next'
import { sortBy } from 'lodash'
import { FC, useEffect } from 'react'
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

  // Get all models for lookup
  const allModels = providers.flatMap((p) => p.models)

  // Check if embedding settings were previously configured
  const isEmbeddingConfigured = memoryConfig?.embedderModel !== undefined

  // Initialize form with current memory config when modal opens
  useEffect(() => {
    if (visible && memoryConfig) {
      form.setFieldsValue({
        llmModel: memoryConfig.llmModel ? getModelUniqId(memoryConfig.llmModel) : undefined,
        embedderModel: memoryConfig.embedderModel ? getModelUniqId(memoryConfig.embedderModel) : undefined,
        embedderDimensions: memoryConfig.embedderDimensions
        // customFactExtractionPrompt: memoryConfig.customFactExtractionPrompt,
        // customUpdateMemoryPrompt: memoryConfig.customUpdateMemoryPrompt
      })
    }
  }, [visible, memoryConfig, form])

  const handleFormSubmit = (values: any) => {
    // Convert model IDs back to Model objects
    const llmModel = values.llmModel ? allModels.find((m) => getModelUniqId(m) === values.llmModel) : undefined
    const embedderModel = values.embedderModel
      ? allModels.find((m) => getModelUniqId(m) === values.embedderModel)
      : undefined

    const updatedConfig = {
      ...memoryConfig,
      llmModel,
      embedderModel,
      embedderDimensions: values.embedderDimensions
      // customFactExtractionPrompt: values.customFactExtractionPrompt,
      // customUpdateMemoryPrompt: values.customUpdateMemoryPrompt
    }

    dispatch(updateMemoryConfig(updatedConfig))
    onSubmit(updatedConfig)
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
    <Modal title="Memory Settings" open={visible} onOk={form.submit} onCancel={onCancel} width={600}>
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
          <Select
            placeholder="Select Embedding Model"
            options={embeddingSelectOptions}
            disabled={isEmbeddingConfigured}
          />
        </Form.Item>
        <Form.Item
          label="Embedding Dimensions"
          name="embedderDimensions"
          rules={[{ required: true, message: 'Please enter embedding dimensions' }]}>
          <Input type="number" placeholder="1536" disabled={isEmbeddingConfigured} />
        </Form.Item>
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
