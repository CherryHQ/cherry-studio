import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import ModelTags from '@renderer/components/ModelTags'
import SelectModelPopup from '@renderer/components/Popups/SelectModelPopup'
import { isLocalAi } from '@renderer/config/env'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { getProviderName } from '@renderer/services/ProviderService'
import { Assistant } from '@renderer/types'
import { Button } from 'antd'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  assistant: Assistant
}

const SelectModelButton: FC<Props> = ({ assistant }) => {
  const { model, setModel } = useAssistant(assistant.id)
  const { t } = useTranslation()

  if (isLocalAi) {
    return null
  }

  const onSelectModel = async (event: React.MouseEvent<HTMLElement>) => {
    event.currentTarget.blur()
    const selectedModel = await SelectModelPopup.show({ model })
    if (selectedModel) {
      setModel(selectedModel)
    }
  }

  const providerName = getProviderName(model?.provider)

  return (
    <DropdownButton size="small" type="default" onClick={onSelectModel}>
      <ButtonContent>
        <ModelAvatar model={model} size={20} />
        <ModelName>
          {model ? model.name : t('button.select_model')} {providerName ? '| ' + providerName : ''}
        </ModelName>
        <ModelTags model={model} showFree={false} showReasoning={false} showToolsCalling={false} />
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

export default SelectModelButton
