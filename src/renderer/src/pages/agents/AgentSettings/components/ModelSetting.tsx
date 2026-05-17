import { HelpTooltip } from '@cherrystudio/ui'
import SelectAgentBaseModelButton from '@renderer/pages/agents/components/SelectAgentBaseModelButton'
import type { AgentBaseWithId, UpdateAgentFunctionUnion } from '@renderer/types'
import type { AgentType } from '@shared/data/types/agent'
import type { Model } from '@shared/data/types/model'
import { useTranslation } from 'react-i18next'

import { SettingsItem, SettingsTitle } from '../shared'

export interface ModelSettingProps {
  base: AgentBaseWithId | undefined | null
  /** Agent type for model filtering. Falls back to `claude-code` since that's the only type today. */
  agentType?: AgentType
  update: UpdateAgentFunctionUnion
  isDisabled?: boolean
}

export const ModelSetting = ({ base, agentType = 'claude-code', update, isDisabled }: ModelSettingProps) => {
  const { t } = useTranslation()

  const updateModel = async (model: Model) => {
    if (!base) return
    return update({ id: base.id, model: model.id })
  }

  if (!base) return null

  return (
    <SettingsItem inline>
      <SettingsTitle id="model" contentAfter={<HelpTooltip title={t('agent.add.model.tooltip')} />}>
        {t('common.model')}
      </SettingsTitle>
      <SelectAgentBaseModelButton
        agentBase={base}
        agentType={agentType}
        onSelect={async (model) => {
          await updateModel(model)
        }}
        isDisabled={isDisabled}
      />
    </SettingsItem>
  )
}
