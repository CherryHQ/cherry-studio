import { Terminal } from 'lucide-react'

import { Avatar } from '@cherrystudio/ui'
import { cn } from '@renderer/utils/style'
import { LOCAL_AGENT_PRESETS } from '@shared/ai/localAgent'
import { CODE_CLI_TOOL_PRESETS } from '@shared/data/presets/codeCliTools'

import { CliIcon } from './CliIcon'

export function LocalAgentIcon({
  presetId,
  size = 20,
  className
}: {
  presetId?: string
  size?: number
  className?: string
}) {
  const preset = LOCAL_AGENT_PRESETS.find((entry) => entry.id === presetId)
  const iconId = preset
    ? (CODE_CLI_TOOL_PRESETS.find((tool) => tool.executable === preset.executable)?.id ?? preset.id)
    : undefined
  return (
    <Avatar
      className={cn('items-center justify-center bg-background-subtle', className)}
      style={{ width: size, height: size }}>
      {iconId ? (
        <>
          <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center opacity-40 blur-sm">
            <CliIcon id={iconId} size={size * 1.8} className="shrink-0" />
          </span>
          <CliIcon id={iconId} size={size * 0.7} className="relative shrink-0" />
        </>
      ) : (
        <Terminal size={size * 0.7} />
      )}
    </Avatar>
  )
}
