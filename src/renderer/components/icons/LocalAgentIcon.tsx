import { Terminal } from 'lucide-react'

import { Avatar } from '@cherrystudio/ui'
import { cn } from '@renderer/utils/style'
import { LOCAL_AGENT_PRESETS } from '@shared/ai/localAgent'
import { CODE_CLI_TOOL_PRESETS } from '@shared/data/presets/codeCliTools'

import { CliIcon } from './CliIcon'
import { SETTINGS_LIST_ICON_FRAME_CLASS } from './iconDisplayConfig'

export function LocalAgentIcon({
  presetId,
  cliId,
  size = 20,
  glyphSize,
  variant = 'avatar',
  className
}: {
  presetId?: string
  cliId?: string
  size?: number
  glyphSize?: number
  variant?: 'avatar' | 'card'
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
        glyphSize={glyphSize}
        shape="circle"
        variant={variant === 'card' ? 'card' : 'tile'}
        className={className}
      />
    )
  }

  return (
    <Avatar
      className={cn(
        'items-center justify-center text-foreground',
        variant === 'card' ? cn(SETTINGS_LIST_ICON_FRAME_CLASS, 'bg-background') : 'rounded-full bg-muted',
        className
      )}
      style={{ width: size, height: size }}>
      <Terminal size={glyphSize ?? size * 0.55} />
    </Avatar>
  )
}
