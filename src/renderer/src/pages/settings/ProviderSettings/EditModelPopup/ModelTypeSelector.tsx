import { ModelCapability, ModelType } from '@renderer/types'
import { getDifference, uniqueObjectArray } from '@renderer/utils'
import { Button, Checkbox, Flex } from 'antd'
import { FC, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface ModelTypeSelectorProps {
  modelCapabilities: ModelCapability[]
  originalModelCapabilities: ModelCapability[]
  selectedTypes: string[]
  onCapabilitiesChange: (capabilities: ModelCapability[]) => void
  onUserModified: (modified: boolean) => void
}

const ModelTypeSelector: FC<ModelTypeSelectorProps> = ({
  modelCapabilities,
  originalModelCapabilities,
  selectedTypes,
  onCapabilitiesChange,
  onUserModified
}) => {
  const { t } = useTranslation()
  const [hasUserModified, setHasUserModified] = useState(false)
  const changedTypesRef = useRef<string[]>([])

  const isDisabled = selectedTypes.includes('rerank') || selectedTypes.includes('embedding')
  const isRerankDisabled = selectedTypes.includes('embedding')
  const isEmbeddingDisabled = selectedTypes.includes('rerank')

  const showTypeConfirmModal = (newCapability: ModelCapability) => {
    const onUpdateType = selectedTypes?.find((t) => t === newCapability.type)
    window.modal.confirm({
      title: t('settings.moresetting.warn'),
      content: t('settings.moresetting.check.warn'),
      okText: t('settings.moresetting.check.confirm'),
      cancelText: t('common.cancel'),
      okButtonProps: { danger: true },
      cancelButtonProps: { type: 'primary' },
      onOk: () => {
        if (onUpdateType) {
          const updatedModelCapabilities = modelCapabilities?.map((t) => {
            if (t.type === newCapability.type) {
              return { ...t, isUserSelected: true }
            }
            if (
              ((onUpdateType !== t.type && onUpdateType === 'rerank') ||
                (onUpdateType === 'embedding' && onUpdateType !== t.type)) &&
              t.isUserSelected !== false
            ) {
              changedTypesRef.current.push(t.type)
              return { ...t, isUserSelected: false }
            }
            return t
          })
          onCapabilitiesChange(uniqueObjectArray(updatedModelCapabilities as ModelCapability[]))
        } else {
          const updatedModelCapabilities = modelCapabilities?.map((t) => {
            if (
              ((newCapability.type !== t.type && newCapability.type === 'rerank') ||
                (newCapability.type === 'embedding' && newCapability.type !== t.type)) &&
              t.isUserSelected !== false
            ) {
              changedTypesRef.current.push(t.type)
              return { ...t, isUserSelected: false }
            }
            if (newCapability.type === t.type) {
              return { ...t, isUserSelected: true }
            }
            return t
          })
          updatedModelCapabilities.push(newCapability as any)
          onCapabilitiesChange(uniqueObjectArray(updatedModelCapabilities as ModelCapability[]))
        }
      },
      onCancel: () => {},
      centered: true
    })
  }

  const handleTypeChange = (types: string[]) => {
    setHasUserModified(true)
    onUserModified(true)
    const diff = types.length > selectedTypes.length
    if (diff) {
      const newCapability = getDifference(types, selectedTypes) // checkbox的特性，确保了newCapability只有一个元素
      showTypeConfirmModal({
        type: newCapability[0] as ModelType,
        isUserSelected: true
      })
    } else {
      const disabledTypes = getDifference(selectedTypes, types)
      const onUpdateType = modelCapabilities?.find((t) => t.type === disabledTypes[0])
      if (onUpdateType) {
        const updatedTypes = modelCapabilities?.map((t) => {
          if (t.type === disabledTypes[0]) {
            return { ...t, isUserSelected: false }
          }
          if (
            ((onUpdateType !== t && onUpdateType.type === 'rerank') ||
              (onUpdateType.type === 'embedding' && onUpdateType !== t)) &&
            t.isUserSelected === false
          ) {
            if (changedTypesRef.current.includes(t.type)) {
              return { ...t, isUserSelected: true }
            }
          }
          return t
        })
        onCapabilitiesChange(uniqueObjectArray(updatedTypes as ModelCapability[]))
      } else {
        const updatedModelCapabilities = modelCapabilities?.map((t) => {
          if (
            (disabledTypes[0] === 'rerank' && t.type !== 'rerank') ||
            (disabledTypes[0] === 'embedding' && t.type !== 'embedding' && t.isUserSelected === false)
          ) {
            return { ...t, isUserSelected: true }
          }
          return t
        })
        updatedModelCapabilities.push({ type: disabledTypes[0] as ModelType, isUserSelected: false })
        onCapabilitiesChange(uniqueObjectArray(updatedModelCapabilities as ModelCapability[]))
      }
      changedTypesRef.current.length = 0
    }
  }

  const handleResetTypes = () => {
    onCapabilitiesChange(originalModelCapabilities)
    setHasUserModified(false)
    onUserModified(false)
  }

  return (
    <div>
      <Flex justify="space-between" align="center" style={{ marginBottom: 8 }}>
        <Checkbox.Group
          value={selectedTypes}
          onChange={handleTypeChange}
          options={[
            {
              label: t('models.type.vision'),
              value: 'vision',
              disabled: isDisabled
            },
            {
              label: t('models.type.websearch'),
              value: 'web_search',
              disabled: isDisabled
            },
            {
              label: t('models.type.rerank'),
              value: 'rerank',
              disabled: isRerankDisabled
            },
            {
              label: t('models.type.embedding'),
              value: 'embedding',
              disabled: isEmbeddingDisabled
            },
            {
              label: t('models.type.reasoning'),
              value: 'reasoning',
              disabled: isDisabled
            },
            {
              label: t('models.type.function_calling'),
              value: 'function_calling',
              disabled: isDisabled
            }
          ]}
        />
        {hasUserModified && (
          <Button size="small" onClick={handleResetTypes}>
            {t('common.reset')}
          </Button>
        )}
      </Flex>
    </div>
  )
}

export default ModelTypeSelector
