import { ClaudeCode, Nousresearch, OpenaiCodex, Openclaw, OpenCode } from '@cherrystudio/ui/icons'
import { CodeCli } from '@shared/types/codeCli'
import type { FC } from 'react'

const CLI_ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  [CodeCli.CLAUDE_CODE]: ClaudeCode,
  [CodeCli.OPENAI_CODEX]: OpenaiCodex,
  [CodeCli.OPEN_CODE]: OpenCode,
  [CodeCli.OPENCLAW]: Openclaw,
  [CodeCli.HERMES]: Nousresearch
}

interface CLIIconProps {
  id: string
  size?: number
  className?: string
}

export const CLIIcon: FC<CLIIconProps> = ({ id, size = 28, className }) => {
  const Icon = CLI_ICONS[id]
  if (!Icon) {
    return (
      <div
        className={`flex items-center justify-center rounded-md bg-accent/50 font-medium text-foreground/70 ${className}`}
        style={{ width: size, height: size, fontSize: size * 0.4 }}>
        {id.charAt(0).toUpperCase()}
      </div>
    )
  }
  return <Icon size={size} className={className} />
}
