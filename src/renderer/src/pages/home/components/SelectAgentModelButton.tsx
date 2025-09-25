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
    <Button size="sm" variant="light" className="nodrag rounded-2xl px-1 py-3" onPress={onSelectModel}>
      <div className="flex items-center gap-1.5">
        <ModelAvatar model={apiModelAdapter(model)} size={20} />
        <span className="-mr-0.5 font-medium">
          {model ? model.name : t('button.select_model')} {providerName ? ' | ' + providerName : ''}
        </span>
      </div>
      <ChevronsUpDown size={14} color="var(--color-icon)" />
    </Button>
  )
}

export default SelectAgentModelButton
