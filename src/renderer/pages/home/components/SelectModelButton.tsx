import { Button } from '@cherrystudio/ui'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { SelectChatModelPopup } from '@renderer/components/Popups/SelectModelPopup'
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
    const selectedModel = await SelectChatModelPopup.show({ model, filter: modelFilter })
    if (selectedModel) {
      // 避免更新数据造成关闭弹框的卡顿
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        const enabledWebSearch = isWebSearchModel(selectedModel)
        updateAssistant({
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
      className="h-7 max-w-[min(360px,45vw)] rounded-md border border-transparent border-solid bg-transparent px-2 py-0 text-xs shadow-none">
      <div className="flex min-w-0 items-center gap-1.5">
        <ModelAvatar model={model} size={18} />
        <span className="min-w-0 truncate font-medium text-xs leading-none">
          {model ? model.name : t('button.select_model')} {providerName ? ' | ' + providerName : ''}
        </span>
      </div>
      <ChevronsUpDown size={13} className="text-muted-foreground" />
      {!provider && <Tag color="error">{t('models.invalid_model')}</Tag>}
    </Button>
  )
}

export default SelectModelButton
