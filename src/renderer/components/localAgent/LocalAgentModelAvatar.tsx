import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { LocalAgentIcon } from '@renderer/components/icons/LocalAgentIcon'
import type { LocalAgentModelOption } from '@renderer/hooks/agent/useLocalAgentModelSelection'

export function LocalAgentModelAvatar({
  model,
  presetId,
  size,
  className
}: {
  model?: LocalAgentModelOption
  presetId?: string
  size: number
  className?: string
}) {
  return (
    <ModelAvatar
      model={model?.registryModel ? { ...model, id: model.registryModel.id } : model}
      size={size}
      className={className}
      fallback={
        model?.source !== 'gateway' ? (
          <LocalAgentIcon presetId={presetId} size={size} className={className} />
        ) : undefined
      }
    />
  )
}
