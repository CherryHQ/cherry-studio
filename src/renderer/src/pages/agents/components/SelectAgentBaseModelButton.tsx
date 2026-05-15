import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { ModelSelector } from '@renderer/components/Selector'
import { fromSharedModel } from '@renderer/config/models/_bridge'
import { useAgentModelFilter } from '@renderer/hooks/agents/useAgentModelFilter'
import { useModelById } from '@renderer/hooks/useModels'
import { useProviderDisplayName } from '@renderer/hooks/useProviders'
import type { AgentBaseWithId, Model } from '@renderer/types'
import type { AgentType } from '@shared/data/types/agent'
import type { Model as SharedModel, UniqueModelId } from '@shared/data/types/model'
import type { ButtonProps } from 'antd'
import { Button } from 'antd'
import { ChevronsUpDown } from 'lucide-react'
import { type CSSProperties, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  agentBase: AgentBaseWithId
  /** Agent type — drives model filtering (e.g. claude-code only allows Anthropic-compatible providers + Claude models). */
  agentType: AgentType
  onSelect: (model: Model) => Promise<void>
  isDisabled?: boolean
  className?: string
  buttonStyle?: CSSProperties
  buttonSize?: ButtonProps['size']
  avatarSize?: number
  fontSize?: number
  iconSize?: number
  containerClassName?: string
}

const SelectAgentBaseModelButton = ({
  agentBase: agent,
  agentType,
  onSelect,
  isDisabled,
  className,
  buttonStyle,
  buttonSize = 'small',
  avatarSize = 20,
  fontSize = 12,
  iconSize = 14,
  containerClassName
}: Props) => {
  const { t } = useTranslation()
  const { model: currentSharedModel } = useModelById((agent?.model ?? '') as UniqueModelId)
  const model = useMemo(
    () => (currentSharedModel ? fromSharedModel(currentSharedModel) : undefined),
    [currentSharedModel]
  )
  const modelFilter = useAgentModelFilter(agentType)
  const providerName = useProviderDisplayName(currentSharedModel?.providerId)

  const handleSelect = useCallback(
    (selected: SharedModel | undefined) => {
      if (!selected || selected.id === agent?.model) return
      void onSelect(fromSharedModel(selected))
    },
    [agent?.model, onSelect]
  )

  if (!agent) return null

  const mergedStyle: CSSProperties = {
    borderRadius: 20,
    fontSize,
    padding: 2,
    ...buttonStyle
  }

  return (
    <ModelSelector
      multiple={false}
      value={currentSharedModel}
      filter={modelFilter}
      onSelect={handleSelect}
      trigger={
        <Button size={buttonSize} type="text" className={className} style={mergedStyle} disabled={isDisabled}>
          <div className={containerClassName || 'flex w-full items-center gap-1.5'}>
            <div className="flex flex-1 items-center gap-1.5 overflow-x-hidden">
              <ModelAvatar model={model} size={avatarSize} />
              <span className="truncate text-(--color-text)">
                {model ? model.name : t('button.select_model')} {providerName ? ' | ' + providerName : ''}
              </span>
            </div>
            <ChevronsUpDown size={iconSize} color="var(--color-icon)" />
          </div>
        </Button>
      }
    />
  )
}

export default SelectAgentBaseModelButton
