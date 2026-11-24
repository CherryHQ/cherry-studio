import { Terminal } from 'lucide-react'

import { Avatar } from '@cherrystudio/ui'
import { cn } from '@renderer/utils/style'
import { LOCAL_AGENT_PRESETS } from '@shared/ai/localAgent'
import { CODE_CLI_TOOL_PRESETS } from '@shared/data/presets/codeCliTools'

import { CliIcon } from './CliIcon'

export function LocalAgentIcon({
  presetId,
  cliId,
  size = 20,
  className
}: {
  presetId?: string
  cliId?: string
  size?: number
  className?: string
}) {
  const preset = LOCAL_AGENT_PRESETS.find((entry) => entry.id === presetId)
  const iconId =
    cliId ??
    (preset
      ? (CODE_CLI_TOOL_PRESETS.find((tool) => tool.executable === preset.executable)?.id ?? preset.id)
      : undefined)
  if (iconId) {
    return (
      <CliIcon
        id={iconId}
        size={size}
        shape="circle"
        className={cn('ring-1 ring-inset ring-foreground/10', className)}
      />
    )
  }

  return (
    <Avatar
      className={cn(
        'items-center justify-center bg-muted text-foreground ring-1 ring-inset ring-foreground/10',
        className
      )}
      style={{ width: size, height: size }}>
      <Terminal size={size * 0.55} />
    </Avatar>
  )
}
