import { TopView } from '@renderer/components/TopView'
import { isEmbeddingModel } from '@renderer/config/models'
import { useKnowledgeBases } from '@renderer/hooks/useKnowledge'
import { useProviders } from '@renderer/hooks/useProvider'
import AiProvider from '@renderer/providers/AiProvider'
import { getKnowledgeBaseParams } from '@renderer/services/KnowledgeService'
import { getModelUniqId } from '@renderer/services/ModelService'
import { Model } from '@renderer/types'
import { getErrorMessage } from '@renderer/utils/error'
import { Form, Input, Modal, Select } from 'antd'
import { find, sortBy } from 'lodash'
import { nanoid } from 'nanoid'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface ShowParams {
  title: string
}

interface FormData {
  name: string
  model: string
}

interface Props extends ShowParams {
  resolve: (data: any) => void
}

const PopupContainer: React.FC<Props> = ({ title, resolve }) => {
  const [open, setOpen] = useState(true)
  const [loading, setLoading] = useState(false)
  const [form] = Form.useForm<FormData>()
  const { t } = useTranslation()
  const { providers } = useProviders()
  const { addKnowledgeBase } = useKnowledgeBases()
  const allModels = providers
    .map((p) => p.models)
    .flat()
    .filter((model) => isEmbeddingModel(model))
  const nameInputRef = useRef<any>(null)

  const selectOptions = providers
    .filter((p) => p.models.length > 0)
    .map((p) => ({
      label: p.isSystem ? t(`provider.${p.id}`) : p.name,
      title: p.name,
      options: sortBy(p.models, 'name')
        .filter((model) => isEmbeddingModel(model))
        .map((m) => ({
          label: m.name,
          value: getModelUniqId(m)
        }))
    }))
    .filter((group) => group.options.length > 0)

  const onOk = async () => {
    try {
      const values = await form.validateFields()
      const selectedModel = find(allModels, JSON.parse(values.model)) as Model

      if (selectedModel) {
        setLoading(true)
        const provider = providers.find((p) => p.id === selectedModel.provider)

        if (!provider) {
          return
        }

        const aiProvider = new AiProvider(provider)
        let dimensions = 0

        try {
          dimensions = await aiProvider.getEmbeddingDimensions(selectedModel)
        } catch (error) {
          console.error('Error getting embedding dimensions:', error)
          window.message.error(t('message.error.get_embedding_dimensions') + '\n' + getErrorMessage(error))
          setLoading(false)
          return
        }

        const newBase = {
          id: nanoid(),
          name: values.name,
          model: selectedModel,
          dimensions,
          items: [],
          created_at: Date.now(),
          updated_at: Date.now(),
          version: 1
        }

        await window.api.knowledgeBase.create(getKnowledgeBaseParams(newBase))

        addKnowledgeBase(newBase as any)
        setOpen(false)
        resolve(newBase)
      }
    } catch (error) {
      console.error('Validation failed:', error)
    }
  }

  const onCancel = () => {
    setOpen(false)
  }

  const onClose = () => {
    resolve(null)
  }

  return (
    <Modal
      title={title}
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      afterClose={onClose}
      afterOpenChange={(visible) => visible && nameInputRef.current?.focus()}
      destroyOnClose
      centered
      okButtonProps={{ loading }}>
      <Form form={form} layout="vertical">
        <Form.Item
          name="name"
          label={t('common.name')}
          rules={[{ required: true, message: t('message.error.enter.name') }]}>
          <Input placeholder={t('common.name')} ref={nameInputRef} />
        </Form.Item>

        <Form.Item
          name="model"
          label={t('models.embedding_model')}
          tooltip={{ title: t('models.embedding_model_tooltip'), placement: 'right' }}
          rules={[{ required: true, message: t('message.error.enter.model') }]}>
          <Select style={{ width: '100%' }} options={selectOptions} placeholder={t('settings.models.empty')} />
        </Form.Item>
      </Form>
    </Modal>
  )
}

export default class AddKnowledgePopup {
  static hide() {
    TopView.hide('AddKnowledgePopup')
  }

  static show(props: ShowParams) {
    return new Promise<any>((resolve) => {
      TopView.show(
        <PopupContainer
          {...props}
          resolve={(v) => {
            resolve(v)
            this.hide()
          }}
        />,
        'AddKnowledgePopup'
      )
    })
  }
}
