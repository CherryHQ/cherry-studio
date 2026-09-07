import type { IconComponent } from '@cherrystudio/ui/icons'
import {
  AntigravityCli,
  ClaudeCode,
  GeminiCli,
  GithubCopilotCli,
  KimiCli as KimiCode,
  OpenaiCodex,
  OpenCode,
  PiCli,
  QoderCli,
  QwenCode
} from '@cherrystudio/ui/icons'
import { Deepseek, Nousresearch, Openclaw } from '@cherrystudio/ui/icons/providers'
import { cn } from '@renderer/utils/style'
import { CodeCli } from '@shared/types/codeCli'
import type { ComponentType, FC, SVGProps } from 'react'

/** `label` is an i18n key; resolve it with `t()` before rendering. */
export const CLI_TOOLS = [
  { value: CodeCli.CLAUDE_CODE, label: 'code.cli_tools.claude_code', icon: ClaudeCode },
  { value: CodeCli.OPENAI_CODEX, label: 'code.cli_tools.openai_codex', icon: OpenaiCodex },
  { value: CodeCli.ANTIGRAVITY_CLI, label: 'code.cli_tools.antigravity_cli', icon: AntigravityCli },
  { value: CodeCli.GEMINI_CLI, label: 'code.cli_tools.gemini_cli', icon: GeminiCli },
  { value: CodeCli.OPEN_CODE, label: 'code.cli_tools.opencode', icon: OpenCode },
  { value: CodeCli.QWEN_CODE, label: 'code.cli_tools.qwen_code', icon: QwenCode },
  { value: CodeCli.KIMI_CODE, label: 'code.cli_tools.kimi_code', icon: KimiCode },
  { value: CodeCli.QODER_CLI, label: 'code.cli_tools.qoder_cli', icon: QoderCli },
  { value: CodeCli.GITHUB_COPILOT_CLI, label: 'code.cli_tools.github_copilot_cli', icon: GithubCopilotCli },
  { value: CodeCli.PI, label: 'code.cli_tools.pi', icon: PiCli },
  { value: CodeCli.HERMES, label: 'code.cli_tools.hermes', icon: Nousresearch },
  { value: CodeCli.OPENCLAW, label: 'code.cli_tools.openclaw', icon: Openclaw },
  { value: CodeCli.DEEPSEEK_HARNESS, label: 'code.cli_tools.deepseek_harness', icon: Deepseek }
] as const satisfies ReadonlyArray<{ value: CodeCli; label: string; icon: IconComponent }>

type SvgIcon = ComponentType<SVGProps<SVGSVGElement>>

const CLI_ICONS: Record<string, SvgIcon> = Object.fromEntries(CLI_TOOLS.map((tool) => [tool.value, tool.icon]))

// Crop transparent source-canvas padding so the artwork shares a consistent optical size.
const OPTICAL_VIEWBOXES: Partial<Record<CodeCli, string>> = {
  [CodeCli.OPEN_CODE]: '16 16 88 88',
  [CodeCli.HERMES]: '26 26 68 68',
  [CodeCli.OPENCLAW]: '26 26 68 68',
  [CodeCli.DEEPSEEK_HARNESS]: '26 26 68 68'
}

interface CliIconProps {
  id: string
  size?: number
  className?: string
}

export const CliIcon: FC<CliIconProps> = ({ id, size = 28, className }) => {
  const Icon = CLI_ICONS[id]
  if (!Icon) {
    return (
      <div
        className={cn(
          'flex items-center justify-center rounded-md bg-accent/50 font-medium text-muted-foreground',
          className
        )}
        style={{ width: size, height: size, fontSize: size * 0.4 }}>
        {id.charAt(0).toUpperCase()}
      </div>
    )
  }

  const opticalViewBox = OPTICAL_VIEWBOXES[id as CodeCli]
  if (opticalViewBox) {
    return <Icon width={size} height={size} viewBox={opticalViewBox} className={className} />
  }

  return <Icon width={size} height={size} className={className} />
}
