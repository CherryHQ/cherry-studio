import {
  ClaudeCode,
  GeminiCli,
  GithubCopilotCli,
  KimiCli as KimiCode,
  Nousresearch,
  OpenaiCodex,
  Openclaw,
  OpenCode,
  QoderCli,
  QwenCode
} from '@cherrystudio/ui/icons'
import { CodeCli } from '@shared/types/codeCli'
import type { SVGProps } from 'react'
import type { ComponentType, FC } from 'react'

type SvgIcon = ComponentType<SVGProps<SVGSVGElement>>

const CLI_ICONS: Record<string, SvgIcon> = {
  [CodeCli.CLAUDE_CODE]: ClaudeCode,
  [CodeCli.OPENAI_CODEX]: OpenaiCodex,
  [CodeCli.OPEN_CODE]: OpenCode,
  [CodeCli.OPENCLAW]: Openclaw,
  [CodeCli.HERMES]: Nousresearch,
  [CodeCli.GEMINI_CLI]: GeminiCli,
  [CodeCli.QWEN_CODE]: QwenCode,
  [CodeCli.KIMI_CODE]: KimiCode,
  [CodeCli.QODER_CLI]: QoderCli,
  [CodeCli.GITHUB_COPILOT_CLI]: GithubCopilotCli
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

  return <Icon width={size} height={size} className={className} />
}
