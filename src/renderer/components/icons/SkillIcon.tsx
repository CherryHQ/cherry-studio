import { cn } from '@renderer/utils/style'
import type { SVGProps } from 'react'

type SkillIconProps = SVGProps<SVGSVGElement> & {
  size?: number | string
}

const baseProps = {
  xmlns: 'http://www.w3.org/2000/svg',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true
} as const

// A four-point sparkle — the "special capability" mark — drawn to lucide spec so it sits distinct
// from the quick-phrases bolt (Zap) while matching the surrounding lucide icons.
export default function SkillIcon({ size = 24, className, ...props }: SkillIconProps) {
  return (
    <svg width={size} height={size} {...baseProps} {...props} className={cn('skill-icon', className)}>
      <path d="M12 2 16 8 22 12 16 16 12 22 8 16 2 12 8 8Z" />
    </svg>
  )
}
