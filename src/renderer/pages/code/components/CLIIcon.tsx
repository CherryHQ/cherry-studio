import { cn } from '@renderer/utils/style'
import type { ComponentType, FC, SVGProps } from 'react'

import { CLI_TOOLS } from '../constants/cliTools'

type SvgIcon = ComponentType<SVGProps<SVGSVGElement>>

// Single icon registry: derived from CLI_TOOLS so a tool's icon is declared once.
const CLI_ICONS: Record<string, SvgIcon> = Object.fromEntries(CLI_TOOLS.map((tool) => [tool.value, tool.icon]))

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
        className={cn(
          'flex items-center justify-center rounded-md bg-accent/50 font-medium text-foreground/70',
          className
        )}
        style={{ width: size, height: size, fontSize: size * 0.4 }}>
        {id.charAt(0).toUpperCase()}
      </div>
    )
  }

  return <Icon width={size} height={size} className={className} />
}
