import type { ComponentType } from 'react'
import { useTranslation } from 'react-i18next'

import { ToolArgsTable } from '@renderer/components/chat/messages/tools/shared/ArgsTable'
import PermissionRequestComposer, {
  type PermissionRequestComposerProps
} from '@renderer/components/composer/variants/PermissionRequestComposer'
import { useAgent } from '@renderer/hooks/agent/useAgent'
import { AGENT_AVATAR_TOOL_NAME } from '@shared/ai/agentAvatarTool'

type Props = PermissionRequestComposerProps & {
  agentId?: string
  component?: ComponentType<PermissionRequestComposerProps>
}

export function AgentAvatarPermissionRequest({
  agentId,
  component: Composer = PermissionRequestComposer,
  ...props
}: Props) {
  const { t } = useTranslation()
  const { tool, arguments: input } = props.request.toolResponse
  const isAvatarRequest =
    tool.type === 'mcp' &&
    'serverId' in tool &&
    tool.serverId.replaceAll('_', '-') === 'cherry-tools' &&
    tool.name === AGENT_AVATAR_TOOL_NAME
  const args = input && typeof input === 'object' && !Array.isArray(input) ? input : null
  const explicitId = typeof args?.target_agent_id === 'string' ? args.target_agent_id.trim() : undefined
  const targetId = isAvatarRequest ? (explicitId ?? agentId ?? null) : null
  const { agent: target } = useAgent(targetId)
  if (!isAvatarRequest) return <Composer {...props} />

  const action = args?.action
  const details =
    targetId && target?.name && (action === 'generate' || action === 'restore') ? (
      <div className="px-3 pt-2">
        <ToolArgsTable args={{ action, [t('common.agent')]: `${target.name} (${targetId})` }} />
      </div>
    ) : null

  return <Composer {...props} approvalDetails={details} disableApproval={props.disableApproval || !details} />
}
