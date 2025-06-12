import { TopView } from '@renderer/components/TopView'
import { DEFAULT_KNOWLEDGE_DOCUMENT_COUNT } from '@renderer/config/constant'
import { isEmbeddingModel, isRerankModel } from '@renderer/config/models'
import { NOT_SUPPORTED_REANK_PROVIDERS } from '@renderer/config/providers'
// import { SUPPORTED_REANK_PROVIDERS } from '@renderer/config/providers'
import { useKnowledgeBases } from '@renderer/hooks/useKnowledge'
import { useProviders } from '@renderer/hooks/useProvider'
import { SettingHelpText } from '@renderer/pages/settings'
import AiProvider from '@renderer/providers/AiProvider'
import { getKnowledgeBaseParams } from '@renderer/services/KnowledgeService'
import { getModelUniqId } from '@renderer/services/ModelService'
import { KnowledgeBase, Model } from '@renderer/types'
import { getErrorMessage } from '@renderer/utils/error'
import { Flex, Form, Input, InputNumber, Modal, Select, Slider, Switch } from 'antd'
import { find, sortBy } from 'lodash'
import { nanoid } from 'nanoid'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface ShowParams {
  title: string
}

interface FormData {
  name: string
  model: string
  autoDims: boolean | undefined
  dimensions: number | undefined
  rerankModel: string | undefined
  documentCount: number | undefined
}

interface Props extends ShowParams {
  resolve: (data: any) => void
}

const PopupContainer: React.FC<Props> = ({ title, resolve }) => {
  const [open, setOpen] = useState(true)
  const [loading, setLoading] = useState(false)
  const [autoDims, setAutoDims] = useState(true)
  const [form] = Form.useForm<FormData>()
  const { t } = useTranslation()
  const { providers } = useProviders()
  const { addKnowledgeBase } = useKnowledgeBases()

  const embeddingModels = useMemo(() => {
    return providers
      .map((p) => p.models)
      .flat()
      .filter((model) => isEmbeddingModel(model))
  }, [providers])

  const rerankModels = useMemo(() => {
    return providers
      .map((p) => p.models)
      .flat()
      .filter((model) => isRerankModel(model))
  }, [providers])

  const nameInputRef = useRef<any>(null)

  const embeddingSelectOptions = useMemo(() => {
    return providers
      .filter((p) => p.models.length > 0)
      .map((p) => ({
        label: p.isSystem ? t(`provider.${p.id}`) : p.name,
        title: p.name,
        options: sortBy(p.models, 'name')
          .filter((model) => isEmbeddingModel(model))
          .map((m) => ({
            label: m.name,
            value: getModelUniqId(m),
            providerId: p.id,
            modelId: m.id
          }))
      }))
      .filter((group) => group.options.length > 0)
  }, [providers, t])

  const rerankSelectOptions = useMemo(() => {
    return providers
      .filter((p) => p.models.length > 0)
      .filter((p) => !NOT_SUPPORTED_REANK_PROVIDERS.includes(p.id))
      .map((p) => ({
        label: p.isSystem ? t(`provider.${p.id}`) : p.name,
        title: p.name,
        options: sortBy(p.models, 'name')
          .filter((model) => isRerankModel(model))
          .map((m) => ({
            label: m.name,
            value: getModelUniqId(m)
          }))
      }))
      .filter((group) => group.options.length > 0)
  }, [providers, t])

  const onOk = async () => {
    try {
      const values = await form.validateFields()
      const selectedEmbeddingModel = find(embeddingModels, JSON.parse(values.model)) as Model

      const selectedRerankModel = values.rerankModel
        ? (find(rerankModels, JSON.parse(values.rerankModel)) as Model)
        : undefined

      if (selectedEmbeddingModel) {
        setLoading(true)
        const provider = providers.find((p) => p.id === selectedEmbeddingModel.provider)

        if (!provider) {
          return
        }

        if (autoDims || typeof values.dimensions === 'undefined') {
          try {
            const aiProvider = new AiProvider(provider)
            values.dimensions = await aiProvider.getEmbeddingDimensions(selectedEmbeddingModel)
          } catch (error) {
            console.error('Error getting embedding dimensions:', error)
            window.message.error(t('message.error.get_embedding_dimensions') + '\n' + getErrorMessage(error))
            setLoading(false)
            return
          }
        } else if (typeof values.dimensions === 'string') {
          // 按理来说不应该是string的，但是确实是string
          values.dimensions = parseInt(values.dimensions)
        }

        const newBase: KnowledgeBase = {
          id: nanoid(),
          name: values.name,
          model: selectedEmbeddingModel,
          rerankModel: selectedRerankModel,
          dimensions: values.dimensions,
          documentCount: values.documentCount || DEFAULT_KNOWLEDGE_DOCUMENT_COUNT,
          items: [],
          created_at: Date.now(),
          updated_at: Date.now(),
          version: 1
        }

        await window.api.knowledgeBase.create(getKnowledgeBaseParams(newBase))

        addKnowledgeBase(newBase)
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
          <Select style={{ width: '100%' }} options={embeddingSelectOptions} placeholder={t('settings.models.empty')} />
        </Form.Item>

        <Form.Item
          name="rerankModel"
          label={t('models.rerank_model')}
          tooltip={{ title: t('models.rerank_model_tooltip'), placement: 'right' }}
          rules={[{ required: false, message: t('message.error.enter.model') }]}>
          <Select style={{ width: '100%' }} options={rerankSelectOptions} placeholder={t('settings.models.empty')} />
        </Form.Item>
        <SettingHelpText style={{ marginTop: -15, marginBottom: 20 }}>
          {t('models.rerank_model_not_support_provider', {
            provider: NOT_SUPPORTED_REANK_PROVIDERS.map((id) => t(`provider.${id}`))
          })}
        </SettingHelpText>
        <Form.Item
          name="documentCount"
          label={t('knowledge.document_count')}
          initialValue={DEFAULT_KNOWLEDGE_DOCUMENT_COUNT} // 设置初始值
          tooltip={{ title: t('knowledge.document_count_help') }}>
          <Slider
            style={{ width: '100%' }}
            min={1}
            max={30}
            step={1}
            marks={{ 1: '1', 6: t('knowledge.document_count_default'), 30: '30' }}
          />
        </Form.Item>
        <Form.Item
          name="autoDims"
          colon={false}
          initialValue={true}
          layout="horizontal"
          label={t('knowledge.dimensions_auto_set')}
          tooltip={t('knowledge.dimensions_default')}
          style={{ marginBottom: 0, justifyContent: 'space-between' }}>
          <Flex justify="flex-end" style={{ marginBottom: '1rem' }}>
            <Switch
              checked={autoDims}
              onClick={() => {
                form.setFieldValue('autoDims', !autoDims)
                if (!autoDims) {
                  form.validateFields(['dimensions'])
                }
                setAutoDims(!autoDims)
              }}></Switch>
          </Flex>
        </Form.Item>

        <Form.Item
          name="dimensions"
          colon={false}
          layout="horizontal"
          initialValue={undefined}
          label={t('knowledge.dimensions')}
          tooltip={{ title: t('knowledge.dimensions_size_tooltip') }}
          dependencies={['model']}
          style={{ display: autoDims ? 'none' : 'block' }}
          rules={[
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (getFieldValue('autoDims') || value > 0) {
                  return Promise.resolve()
                } else {
                  return Promise.reject(t('knowledge.dimensions_error_invalid'))
                }
              }
            })
          ]}>
          <InputNumber min={1} style={{ width: '100%' }} placeholder={t('knowledge.dimensions_size_placeholder')} />
        </Form.Item>

        {!autoDims && (
          <SettingHelpText style={{ marginTop: -15, marginBottom: 20 }}>
            {t('knowledge.dimensions_set_right')}
          </SettingHelpText>
        )}
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
