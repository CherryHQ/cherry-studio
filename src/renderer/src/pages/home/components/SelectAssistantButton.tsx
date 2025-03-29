import AssistantAvatar from '@renderer/components/Avatar/AssistantAvatar'
import SelectAssistantPopup from '@renderer/components/Popups/SelectAssistantPopup'
import { useActiveTopicContext } from '@renderer/context/ActiveTopicContext'
import { useAssistants } from '@renderer/hooks/useAssistant'
import { useTopics } from '@renderer/hooks/useTopic'
import { getAssistantById } from '@renderer/services/AssistantService'
import { Button } from 'antd'
import styled from 'styled-components'

const SelectAssistantButton: React.FC = () => {
  const { activeTopic } = useActiveTopicContext()
  const { switchAssistant } = useTopics()
  const { assistants } = useAssistants()

  const currentAssistant = getAssistantById(activeTopic.assistantId) || assistants[0]

  const onSelectAssistant = async (event: React.MouseEvent<HTMLElement>) => {
    event.currentTarget.blur()
    const selectedAssistant = await SelectAssistantPopup.show({ assistantId: currentAssistant.id })

    if (selectedAssistant) {
      switchAssistant(activeTopic, selectedAssistant)
    }
  }

  if (!assistants || assistants.length === 0) {
    return null
  }

  return (
    <DropdownButton size="small" type="default" onClick={onSelectAssistant}>
      <ButtonContent>
        <AssistantAvatar assistant={currentAssistant} size={20} />
        <AssistantName>{currentAssistant.name}</AssistantName>
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

const AssistantName = styled.span`
  font-weight: 500;
`

export default SelectAssistantButton
