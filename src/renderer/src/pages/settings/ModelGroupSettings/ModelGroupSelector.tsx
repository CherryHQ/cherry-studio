import { useProviders } from '@renderer/hooks/useProvider'
import { getModelUniqId } from '@renderer/services/ModelService'
import { Model, ModelReference } from '@renderer/types'
import { Select, Tag } from 'antd'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  value?: ModelReference[]
  onChange?: (value: ModelReference[]) => void
}

const ModelGroupSelector: FC<Props> = ({ value = [], onChange }) => {
  const { t } = useTranslation()
  const { providers } = useProviders()

  const allModels = providers.flatMap((provider) =>
    provider.models.map((model) => ({
      ...model,
      provider: provider.id,
      providerName: provider.name
    }))
  )

  const selectedKeys = value.map((ref) => `${ref.providerId}:${ref.modelId}`)

  const handleChange = (newSelectedKeys: string[]) => {
    const newReferences: ModelReference[] = newSelectedKeys
      .filter((key) => key && typeof key === 'string')
      .map((key) => {
        const [providerId, modelId] = key.split(':')
        return { providerId, modelId }
      })
    onChange?.(newReferences)
  }

  const options = allModels.map((model) => ({
    label: `${model.name} (${model.providerName})`,
    value: `${model.provider}:${model.id}`,
    model
  }))

  return (
    <Select
      mode="multiple"
      style={{ width: '100%' }}
      placeholder={t('settings.modelGroup.selectModels')}
      value={selectedKeys}
      onChange={handleChange}
      options={options}
      maxTagCount="responsive"
      showSearch
      filterOption={(input, option) => {
        const label = option?.label as string
        return label.toLowerCase().includes(input.toLowerCase())
      }}
      tagRender={(props) => {
        const { label, value, closable, onClose } = props
        const modelKey = value as string
        
        if (!modelKey || typeof modelKey !== 'string') {
          return (
            <Tag
              color="blue"
              closable={closable}
              onClose={onClose}
              style={{ marginRight: 3, marginBottom: 3 }}>
              {label}
            </Tag>
          )
        }
        
        const [providerId, modelId] = modelKey.split(':')
        const provider = providers.find((p) => p.id === providerId)
        const model = provider?.models.find((m) => m.id === modelId)

        return (
          <Tag
            color="blue"
            closable={closable}
            onClose={onClose}
            style={{ marginRight: 3, marginBottom: 3 }}>
            {model?.name || label}
          </Tag>
        )
      }}
    />
  )
}

export default ModelGroupSelector