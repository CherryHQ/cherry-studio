import { Button } from '@cherrystudio/ui'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { SelectModelPopup } from '@renderer/components/Popups/SelectModelPopup'
import { isLocalAi } from '@renderer/config/env'
import { isEmbeddingModel, isRerankModel, isWebSearchModel } from '@renderer/config/models'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useProvider } from '@renderer/hooks/useProvider'
import { getProviderName } from '@renderer/services/ProviderService'
import type { Assistant, Model } from '@renderer/types'
import { Tag } from 'antd'
import { ChevronsUpDown } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  assistant: Assistant
}

const SelectModelButton: FC<Props> = ({ assistant }) => {
  const { model, updateAssistant } = useAssistant(assistant.id)
  const { t } = useTranslation()
  const timerRef = useRef<NodeJS.Timeout>(undefined)
  const provider = useProvider(model?.provider)

  const modelFilter = (model: Model) => !isEmbeddingModel(model) && !isRerankModel(model)

  const onSelectModel = async () => {
    const selectedModel = await SelectModelPopup.show({ model, filter: modelFilter })
    if (selectedModel) {
      // 避免更新数据造成关闭弹框的卡顿
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        const enabledWebSearch = isWebSearchModel(selectedModel)
        updateAssistant({
          ...assistant,
          model: selectedModel,
          enableWebSearch: enabledWebSearch && assistant.enableWebSearch
        })
      }, 200)
    }
  }

  useEffect(() => {
    return () => {
      clearTimeout(timerRef.current)
    }
  }, [])

  if (isLocalAi) {
    return null
  }

  const providerName = getProviderName(model)

  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={onSelectModel}
      className="mt-0.5 rounded-2xl border border-transparent border-solid bg-transparent px-1 py-3 text-xs shadow-none">
      <ButtonContent>
        <ModelAvatar model={model} size={20} />
        <ModelName>
          {model ? model.name : t('button.select_model')} {providerName ? ' | ' + providerName : ''}
        </ModelName>
      </ButtonContent>
      <ChevronsUpDown size={14} color="var(--color-icon)" />
      {!provider && <Tag color="error">{t('models.invalid_model')}</Tag>}
    </Button>
  )
}

const ButtonContent = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
`

const ModelName = styled.span`
  font-weight: 500;
  margin-right: -2px;
  font-size: 12px;
`

export default SelectModelButton
