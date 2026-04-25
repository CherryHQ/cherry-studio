import { Button } from '@cherrystudio/ui'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { SelectChatModelPopup } from '@renderer/components/Popups/SelectModelPopup'
import { isEmbeddingModel, isRerankModel, isWebSearchModel } from '@renderer/config/models'
import { fromSharedModel } from '@renderer/config/models/_bridge'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useProvider } from '@renderer/hooks/useProvider'
import { getProviderName } from '@renderer/services/ProviderService'
import type { Assistant, Model } from '@renderer/types'
import { Tag } from 'antd'
import { ChevronsUpDown } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  assistant: Assistant
}

const SelectModelButton: FC<Props> = ({ assistant }) => {
  const { model, setModel } = useAssistant(assistant.id)
  const v1Model = useMemo(() => (model ? fromSharedModel(model) : undefined), [model])
  const { t } = useTranslation()
  const timerRef = useRef<NodeJS.Timeout>(undefined)
  const provider = useProvider(v1Model?.provider ?? '')

  const modelFilter = (m: Model) => !isEmbeddingModel(m) && !isRerankModel(m)

  const onSelectModel = async () => {
    const selectedModel = await SelectChatModelPopup.show({ model: v1Model, filter: modelFilter })
    if (selectedModel) {
      // 避免更新数据造成关闭弹框的卡顿
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        const enabledWebSearch = isWebSearchModel(selectedModel)
        setModel(selectedModel, { enableWebSearch: enabledWebSearch && assistant.settings.enableWebSearch })
      }, 200)
    }
  }

  useEffect(() => {
    return () => {
      clearTimeout(timerRef.current)
    }
  }, [])

  const providerName = getProviderName(v1Model)

  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={onSelectModel}
      className="mt-0.5 rounded-2xl border border-transparent border-solid bg-transparent px-1 py-3 text-xs shadow-none">
      <ButtonContent>
        <ModelAvatar model={v1Model} size={20} />
        <ModelName>
          {v1Model ? v1Model.name : t('button.select_model')} {providerName ? ' | ' + providerName : ''}
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
