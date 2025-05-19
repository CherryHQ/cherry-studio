import ChatflowAvatar from '@renderer/components/Avatar/ChatflowAvatar'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import SelectItemPopup from '@renderer/components/Popups/SelectItemPopup'
import { isLocalAi } from '@renderer/config/env'
import { isWebSearchModel } from '@renderer/config/models'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { getProviderName } from '@renderer/services/ProviderService'
import { Assistant, isFlow, isModel, ModelOrChatflowItem } from '@renderer/types'
import { Button } from 'antd'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  assistant: Assistant
}

const SelectModelOrFlowButton: FC<Props> = ({ assistant }) => {
  const { model, chatflow, setModel, setChatflow, updateAssistant } = useAssistant(assistant.id)
  const { t } = useTranslation()

  if (isLocalAi) {
    return null
  }

  const onSelectModelOrFlow = async (event: React.MouseEvent<HTMLElement>) => {
    event.currentTarget.blur()
    const selectedItem: ModelOrChatflowItem | undefined = await SelectItemPopup.show({ item: model })

    if (selectedItem === undefined) return

    if (isModel(selectedItem)) {
      setModel(selectedItem)
      setTimeout(() => {
        const enabledWebSearch = isWebSearchModel(selectedItem)
        updateAssistant({
          ...assistant,
          mode: 'system',
          model: selectedItem,
          chatflow: undefined,
          enableWebSearch: enabledWebSearch && assistant.enableWebSearch
        })
      }, 200)
      return
    }
    if (isFlow(selectedItem)) {
      setChatflow(selectedItem)
      setTimeout(() => {
        updateAssistant({
          ...assistant,
          mode: 'external',
          workflow: undefined,
          chatflow: selectedItem,
          enableWebSearch: false
        })
      }, 200)
      return
    }
  }

  const displayName = chatflow ? chatflow.name : model ? model.name : t('button.select_model')

  const providerOrFlowType = chatflow ? chatflow.providerId : model ? getProviderName(model.provider) : ''

  return (
    <DropdownButton size="small" type="text" onClick={onSelectModelOrFlow}>
      <ButtonContent>
        {chatflow ? <ChatflowAvatar chatflow={chatflow} size={20} /> : <ModelAvatar model={model} size={20} />}
        <ModelName>
          {displayName} {providerOrFlowType ? `| ${providerOrFlowType}` : ''}
        </ModelName>
      </ButtonContent>
    </DropdownButton>
  )
}

const DropdownButton = styled(Button)`
  font-size: 11px;
  border-radius: 15px;
  padding: 12px 8px 12px 3px;
  -webkit-app-region: none;
  box-shadow: none;
  background-color: transparent;
  border: 1px solid transparent;
`

const ButtonContent = styled.div`
  display: flex;
  align-items: center;
  gap: 5px;
`

const ModelName = styled.span`
  font-weight: 500;
`

export default SelectModelOrFlowButton
