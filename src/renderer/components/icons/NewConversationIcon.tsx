import { cn } from '@renderer/utils/style'
import type { SVGProps } from 'react'

type NewConversationIconProps = SVGProps<SVGSVGElement> & {
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

export default function NewConversationIcon({ size = 24, className, ...props }: NewConversationIconProps) {
  return (
    <svg width={size} height={size} {...baseProps} {...props} className={cn('new-conversation-icon', className)}>
      <path d="M13 4H6a2 2 0 0 0-2 2v13l4-3h10a2 2 0 0 0 2-2v-3" />
      <path d="M18 3.5v5" />
      <path d="M15.5 6h5" />
    </svg>
  )
}
