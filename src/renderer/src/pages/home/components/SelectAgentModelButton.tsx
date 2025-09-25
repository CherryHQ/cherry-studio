import { Button } from '@heroui/react'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { SelectApiModelPopup } from '@renderer/components/Popups/SelectModelPopup'
import { useUpdateAgent } from '@renderer/hooks/agents/useUpdateAgent'
import { AgentEntity, ApiModel } from '@renderer/types'
import { getModelFilterByAgentType } from '@renderer/utils/agentSession'
import { apiModelAdapter } from '@renderer/utils/model'
import { ChevronsUpDown } from 'lucide-react'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  agent: AgentEntity
  model: ApiModel
}

const SelectAgentModelButton: FC<Props> = ({ agent, model }) => {
  const { t } = useTranslation()
  const update = useUpdateAgent()

  const modelFilter = getModelFilterByAgentType(agent.type)

  if (!agent) return null

  const onSelectModel = async () => {
    const selectedModel = await SelectApiModelPopup.show({ model, filter: modelFilter })
    if (selectedModel && selectedModel.id !== agent.model) {
      update({ id: agent.id, model: selectedModel.id })
    }
  }

  const providerName = model.provider_name

  return (
    <DropdownButton size="sm" onPress={onSelectModel}>
      <ButtonContent>
        <ModelAvatar model={apiModelAdapter(model)} size={20} />
        <ModelName>
          {model ? model.name : t('button.select_model')} {providerName ? ' | ' + providerName : ''}
        </ModelName>
      </ButtonContent>
      <ChevronsUpDown size={14} color="var(--color-icon)" />
    </DropdownButton>
  )
}

const DropdownButton = styled(Button)`
  font-size: 11px;
  border-radius: 15px;
  padding: 13px 5px;
  -webkit-app-region: none;
  box-shadow: none;
  background-color: transparent;
  border: 1px solid transparent;
  margin-top: 1px;
`

const ButtonContent = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
`

const ModelName = styled.span`
  font-weight: 500;
  margin-right: -2px;
`

export default SelectAgentModelButton
