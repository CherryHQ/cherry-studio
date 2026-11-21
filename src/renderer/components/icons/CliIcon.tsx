import type { FC } from 'react'

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
import { Deepseek, Minimax, Nousresearch, Openclaw } from '@cherrystudio/ui/icons/providers'
import { cn } from '@renderer/utils/style'
import { CodeCli } from '@shared/types/codeCli'

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
  { value: CodeCli.DEEPSEEK_HARNESS, label: 'code.cli_tools.deepseek_harness', icon: Deepseek },
  { value: CodeCli.MINIMAX_CODE, label: 'code.cli_tools.minimax_code', icon: Minimax }
] as const satisfies ReadonlyArray<{ value: CodeCli; label: string; icon: IconComponent }>

const CLI_ICONS: Record<string, (typeof CLI_TOOLS)[number]['icon'] | undefined> = Object.fromEntries(
  CLI_TOOLS.map((tool) => [tool.value, tool.icon])
)

interface CliIconProps {
  id: string
  size?: number
  glyphSize?: number
  shape?: 'circle' | 'rounded'
  className?: string
}

export const CliIcon: FC<CliIconProps> = ({ id, size = 28, glyphSize, shape = 'rounded', className }) => {
  const Icon = CLI_ICONS[id]
  const hasTileArtwork =
    Icon && ('Avatar' in Icon || id === CodeCli.OPENAI_CODEX || id === CodeCli.GEMINI_CLI || id === CodeCli.KIMI_CODE)
  const artworkSize =
    id === CodeCli.GEMINI_CLI
      ? shape === 'circle'
        ? 'size-[80%]'
        : 'size-[90%]'
      : hasTileArtwork
        ? 'size-full'
        : 'size-[70%]'

  // OpenCode's source has transparent padding around the mark.
  const opticalViewBox = id === CodeCli.OPEN_CODE ? { viewBox: '16 16 88 88' } : {}

  return (
    <span
      aria-hidden="true"
      data-slot="cli-icon"
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden [--icon-neutral-background:var(--muted)] dark:[--icon-neutral-background:initial]',
        shape === 'circle' ? 'rounded-full' : 'rounded-[32%]',
        !hasTileArtwork && 'bg-muted',
        id === CodeCli.OPEN_CODE && 'text-foreground',
        className
      )}
      style={{ width: size, height: size }}>
      {Icon ? (
        <Icon
          {...opticalViewBox}
          className={artworkSize}
          style={hasTileArtwork || glyphSize === undefined ? undefined : { width: glyphSize, height: glyphSize }}
        />
      ) : (
        <span className="font-medium text-muted-foreground" style={{ fontSize: size * 0.4 }}>
          {id.charAt(0).toUpperCase()}
        </span>
      )}
    </span>
  )
}
