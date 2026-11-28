import type { FC } from 'react'

import type { IconComponent } from '@cherrystudio/ui/icons'
import {
  ClineCli,
  KiloCli,
  GooseCli,
  CodebuddyCodeCli,
  CommandCodeCli,
  DimcodeCli,
  MuseCodeCli,
  AuggieCli,
  JunieCli,
  FactoryDroidCli,
  DevinCli,
  MistralVibeCli,
  AmpCli,
  DeepagentsCli,
  DeepseekHarnessCli,
  GlmAcpAgentCli,
  GrokBuildCli,
  CortexCodeCli,
  PoolsideCli,
  AntigravityCli,
  ClaudeCode,
  CursorCli,
  GithubCopilotCli,
  KimiCli as KimiCode,
  KiroCli,
  TraeCli,
  OpenaiCodex,
  OpenCode,
  PiCli,
  OmpCli,
  SnowCli,
  ZcodeCli,
  QoderCli,
  QwenCode
} from '@cherrystudio/ui/icons'
import { Minimax, Nousresearch, Openclaw } from '@cherrystudio/ui/icons/providers'
import { cn } from '@renderer/utils/style'
import { CodeCli } from '@shared/types/codeCli'

import { SETTINGS_LIST_ICON_FRAME_CLASS, SETTINGS_LIST_TILE_RADIUS } from './iconDisplayConfig'

/** `label` is an i18n key; resolve it with `t()` before rendering. */
export const CLI_TOOLS = [
  { value: CodeCli.CLAUDE_CODE, label: 'code.cli_tools.claude_code', icon: ClaudeCode },
  { value: CodeCli.OPENAI_CODEX, label: 'code.cli_tools.openai_codex', icon: OpenaiCodex },
  { value: CodeCli.ANTIGRAVITY_CLI, label: 'code.cli_tools.antigravity_cli', icon: AntigravityCli },
  { value: CodeCli.OPEN_CODE, label: 'code.cli_tools.opencode', icon: OpenCode },
  { value: CodeCli.QWEN_CODE, label: 'code.cli_tools.qwen_code', icon: QwenCode },
  { value: CodeCli.KIMI_CODE, label: 'code.cli_tools.kimi_code', icon: KimiCode },
  { value: CodeCli.QODER_CLI, label: 'code.cli_tools.qoder_cli', icon: QoderCli },
  { value: CodeCli.GITHUB_COPILOT_CLI, label: 'code.cli_tools.github_copilot_cli', icon: GithubCopilotCli },
  { value: CodeCli.PI, label: 'code.cli_tools.pi', icon: PiCli },
  { value: CodeCli.HERMES, label: 'code.cli_tools.hermes', icon: Nousresearch },
  { value: CodeCli.OPENCLAW, label: 'code.cli_tools.openclaw', icon: Openclaw },
  { value: CodeCli.DEEPSEEK_HARNESS, label: 'code.cli_tools.deepseek_harness', icon: DeepseekHarnessCli },
  { value: CodeCli.MINIMAX_CODE, label: 'code.cli_tools.minimax_code', icon: Minimax }
] as const satisfies ReadonlyArray<{ value: CodeCli; label: string; icon: IconComponent }>

const CLI_ICONS: Record<string, IconComponent | undefined> = {
  ...Object.fromEntries(CLI_TOOLS.map((tool) => [tool.value, tool.icon])),
  cline: ClineCli,
  kilo: KiloCli,
  goose: GooseCli,
  'codebuddy-code': CodebuddyCodeCli,
  'command-code': CommandCodeCli,
  dimagent: DimcodeCli,
  'muse-code': MuseCodeCli,
  auggie: AuggieCli,
  junie: JunieCli,
  'factory-droid': FactoryDroidCli,
  devin: DevinCli,
  'antigravity-acp': AntigravityCli,
  'mistral-vibe': MistralVibeCli,
  'amp-acp': AmpCli,
  'pi-acp': PiCli,
  omp: OmpCli,
  snow: SnowCli,
  zcode: ZcodeCli,
  deepagents: DeepagentsCli,
  'glm-acp-agent': GlmAcpAgentCli,
  'grok-build': GrokBuildCli,
  'cortex-code': CortexCodeCli,
  poolside: PoolsideCli,
  cursor: CursorCli,
  'qoder-global': QoderCli,
  kiro: KiroCli,
  trae: TraeCli
}

// Crop transparent source-canvas padding so the artwork shares a consistent optical size.
const OPTICAL_VIEWBOXES: Partial<Record<CodeCli, string>> = {
  [CodeCli.OPEN_CODE]: '16 16 88 88',
  [CodeCli.KIMI_CODE]: '20 23 77 77',
  [CodeCli.OPENCLAW]: '12 10 96 96',
  [CodeCli.MINIMAX_CODE]: '24 24 72 72'
}

// Strip baked tile fills from artwork rendered as an inset glyph.
const INSET_ARTWORK_CLASSES: Partial<Record<CodeCli, string>> = {
  [CodeCli.OPENCLAW]: '[&>path:first-child]:hidden',
  [CodeCli.MINIMAX_CODE]: '[&>path:first-child]:hidden [&>path:nth-child(2)]:fill-current'
}

const TILE_ARTWORK_IDS = new Set<string>([
  CodeCli.OPENAI_CODEX,
  CodeCli.HERMES,
  CodeCli.KIMI_CODE,
  'codebuddy-code',
  'command-code',
  'kiro',
  'zcode',
  'snow'
])

interface CliIconProps {
  id: string
  size?: number
  glyphSize?: number
  shape?: 'circle' | 'rounded'
  variant?: 'tile' | 'card'
  className?: string
}

export const CliIcon: FC<CliIconProps> = ({
  id,
  size = 28,
  glyphSize,
  shape = 'rounded',
  variant = 'tile',
  className
}) => {
  const Icon = CLI_ICONS[id]
  const hasTileArtwork = Boolean(Icon && TILE_ARTWORK_IDS.has(id))
  const croppedViewBox = OPTICAL_VIEWBOXES[id as CodeCli]
  const opticalViewBox = croppedViewBox ? { viewBox: croppedViewBox } : {}

  if (variant === 'card') {
    return (
      <span
        aria-hidden="true"
        data-slot="cli-icon"
        data-variant="card"
        className={cn(
          SETTINGS_LIST_ICON_FRAME_CLASS,
          'inline-flex items-center justify-center overflow-hidden bg-background text-foreground',
          !hasTileArtwork && '[--icon-neutral-background:transparent]',
          className
        )}
        style={{ width: size, height: size }}>
        {Icon ? (
          hasTileArtwork ? (
            <Icon
              {...(id === CodeCli.KIMI_CODE ? { viewBox: '20 20 81 81' } : opticalViewBox)}
              className={cn(
                'size-full overflow-hidden [&_[data-slot=cli-icon-mark]]:origin-center [&_[data-slot=cli-icon-mark]]:scale-[0.8]',
                // Center the K on the tile and keep the blue accent in place relative to it.
                id === CodeCli.KIMI_CODE
                  ? '[&_[data-slot=cli-icon-mark]]:[transform-box:fill-box] [&_[data-slot=cli-icon-mark]]:translate-x-[9%] [&_[data-slot=cli-icon-mark]]:-translate-y-[1.5%]'
                  : '[&_[data-slot=cli-icon-mark]]:[transform-box:view-box]'
              )}
              style={{ borderRadius: SETTINGS_LIST_TILE_RADIUS }}
            />
          ) : (
            <Icon
              {...opticalViewBox}
              className={cn('size-[70%]', INSET_ARTWORK_CLASSES[id as CodeCli])}
              style={glyphSize === undefined ? undefined : { width: glyphSize, height: glyphSize }}
            />
          )
        ) : (
          <span className="font-medium text-muted-foreground" style={{ fontSize: size * 0.4 }}>
            {id.charAt(0).toUpperCase()}
          </span>
        )}
      </span>
    )
  }

  // Full-bleed artwork must reach the frame so its corners are clipped.
  const artworkSize = hasTileArtwork ? size : (glyphSize ?? size * 0.72)

  return (
    <span
      aria-hidden="true"
      data-slot="cli-icon"
      data-variant="tile"
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden text-foreground [--icon-neutral-background:var(--muted)] dark:[--icon-neutral-background:initial]',
        shape === 'circle' ? 'rounded-full' : 'rounded-[32%]',
        !hasTileArtwork && 'bg-muted',
        className
      )}
      style={{ width: size, height: size }}>
      {Icon ? (
        <Icon
          {...opticalViewBox}
          className={shape === 'circle' ? INSET_ARTWORK_CLASSES[id as CodeCli] : undefined}
          style={{ width: artworkSize, height: artworkSize }}
        />
      ) : (
        <span className="font-medium text-muted-foreground" style={{ fontSize: size * 0.4 }}>
          {id.charAt(0).toUpperCase()}
        </span>
      )}
    </span>
  )
}
