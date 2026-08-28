import { cn } from '@renderer/utils/style'
import { CodeCli } from '@shared/types/codeCli'
import type { ComponentType, FC, SVGProps } from 'react'

import { CLI_TOOLS } from '../constants/cliTools'

type SvgIcon = ComponentType<SVGProps<SVGSVGElement>>

// Single icon registry: derived from CLI_TOOLS so a tool's icon is declared once.
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
