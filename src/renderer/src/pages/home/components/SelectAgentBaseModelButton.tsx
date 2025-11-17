import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { SelectApiModelPopup } from '@renderer/components/Popups/SelectModelPopup'
import { agentModelFilter } from '@renderer/config/models'
import { useApiModel } from '@renderer/hooks/agents/useModel'
import { getProviderNameById } from '@renderer/services/ProviderService'
import type { AgentBaseWithId, ApiModel } from '@renderer/types'
import { isAgentSessionEntity } from '@renderer/types'
import { isAgentEntity } from '@renderer/types'
import { getModelFilterByAgentType } from '@renderer/utils/agentSession'
import { apiModelAdapter } from '@renderer/utils/model'
import type { ButtonProps } from 'antd'
import { Button } from 'antd'
import { ChevronsUpDown } from 'lucide-react'
import type { CSSProperties, FC } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  agentBase: AgentBaseWithId
  onSelect: (model: ApiModel) => Promise<void>
  isDisabled?: boolean
  /** Custom className for the button */
  className?: string
  /** Custom inline styles for the button (merged with default styles) */
  buttonStyle?: CSSProperties
  /** Custom button size */
  buttonSize?: ButtonProps['size']
  /** Custom avatar size */
  avatarSize?: number
  /** Custom font size */
  fontSize?: number
  /** Custom icon size */
  iconSize?: number
  /** Custom className for the inner container (e.g., for justify-between) */
  containerClassName?: string
}

const SelectAgentBaseModelButton: FC<Props> = ({
  agentBase: agent,
  onSelect,
  isDisabled,
  className,
  buttonStyle,
  buttonSize = 'small',
  avatarSize = 20,
  fontSize = 12,
  iconSize = 14,
  containerClassName
}) => {
  const { t } = useTranslation()
  const model = useApiModel({ id: agent?.model })

  const apiFilter = isAgentEntity(agent)
    ? getModelFilterByAgentType(agent.type)
    : isAgentSessionEntity(agent)
      ? getModelFilterByAgentType(agent.agent_type)
      : undefined

  if (!agent) return null

  const onSelectModel = async () => {
    const selectedModel = await SelectApiModelPopup.show({ model, apiFilter: apiFilter, modelFilter: agentModelFilter })
    if (selectedModel && selectedModel.id !== agent.model) {
      onSelect(selectedModel)
    }
  }

  const providerName = model?.provider ? getProviderNameById(model.provider) : model?.provider_name

  // Merge default styles with custom styles
  const mergedStyle: CSSProperties = {
    borderRadius: 20,
    fontSize,
    padding: 2,
    ...buttonStyle
  }

  return (
    <Button
      size={buttonSize}
      type="text"
      className={className}
      style={mergedStyle}
      onClick={onSelectModel}
      disabled={isDisabled}>
      <div className={containerClassName || 'flex w-full items-center gap-1.5'}>
        <div className="flex flex-1 items-center gap-1.5 overflow-x-hidden">
          <ModelAvatar model={model ? apiModelAdapter(model) : undefined} size={avatarSize} />
          <span className="truncate text-[var(--color-text)]">
            {model ? model.name : t('button.select_model')} {providerName ? ' | ' + providerName : ''}
          </span>
        </div>
        <ChevronsUpDown size={iconSize} color="var(--color-icon)" />
      </div>
    </Button>
  )
}

export default SelectAgentBaseModelButton
