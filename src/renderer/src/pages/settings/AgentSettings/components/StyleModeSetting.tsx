import type {
  AgentBaseWithId,
  AgentConfiguration,
  AgentStyleMode,
  UpdateAgentBaseForm,
  UpdateAgentFunctionUnion
} from '@renderer/types'
import { AGENT_STYLE_MODE_PRESETS } from '@renderer/types'
import { Segmented, Tooltip } from 'antd'
import { Info } from 'lucide-react'
import { useCallback, useMemo } from 'react'

import { SettingsItem, SettingsTitle } from '../shared'

interface StyleModeSettingProps {
  base: AgentBaseWithId | undefined | null
  update: UpdateAgentFunctionUnion
}

const options: Array<{ label: string; value: AgentStyleMode }> = [
  { label: '正常模式', value: 'normal' },
  { label: '创意模式', value: 'creative' },
  { label: '严肃模式', value: 'serious' }
]

export const StyleModeSetting = ({ base: agentBase, update }: StyleModeSettingProps) => {
  const config = useMemo(() => agentBase?.configuration ?? ({} as AgentConfiguration), [agentBase?.configuration])
  const mode = config.style_mode ?? 'normal'

  const handleChange = useCallback(
    (value: string | number) => {
      if (!agentBase) return
      const styleMode = value as AgentStyleMode
      const preset = AGENT_STYLE_MODE_PRESETS[styleMode]
      void update({
        id: agentBase.id,
        configuration: {
          ...config,
          style_mode: styleMode,
          temperature: preset.temperature,
          top_p: preset.top_p
        }
      } satisfies UpdateAgentBaseForm)
    },
    [agentBase, config, update]
  )

  if (!agentBase) return null

  return (
    <SettingsItem inline>
      <SettingsTitle
        contentAfter={
          <Tooltip title="用三个简单模式替代温度、top_p 等细参数；CLI Worker 会把模式写进任务指令。">
            <Info size={16} className="text-foreground-400" />
          </Tooltip>
        }>
        Agent 风格
      </SettingsTitle>
      <Segmented size="small" options={options} value={mode} onChange={handleChange} />
    </SettingsItem>
  )
}
