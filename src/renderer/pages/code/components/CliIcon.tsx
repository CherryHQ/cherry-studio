import { cn } from '@renderer/utils/style'
import { CodeCli } from '@shared/types/codeCli'
import type { ComponentType, FC, SVGProps } from 'react'

import { CLI_TOOLS } from '../constants/cliTools'

type SvgIcon = ComponentType<SVGProps<SVGSVGElement>>

// Single icon registry: derived from CLI_TOOLS so a tool's icon is declared once.
const CLI_ICONS: Record<string, SvgIcon> = Object.fromEntries(CLI_TOOLS.map((tool) => [tool.value, tool.icon]))

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

  // The OpenClaw artwork occupies only the center of its 120×120 canvas.
  // Crop that transparent margin so its optical size matches the other CLI icons.
  if (id === CodeCli.OPENCLAW) {
    return <Icon width={size} height={size} viewBox="20 20 80 80" className={className} />
  }

  return <Icon width={size} height={size} className={className} />
}
