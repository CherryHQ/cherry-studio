import { cn } from '@renderer/utils/style'
import type { SVGProps } from 'react'

type SidebarShortcutIconProps = SVGProps<SVGSVGElement> & {
  pinned?: boolean
  size?: number | string
}

export default function SidebarShortcutIcon({
  pinned = false,
  size = 24,
  className,
  ...props
}: SidebarShortcutIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn('sidebar-shortcut-icon', className)}
      {...props}>
      <rect x="2.25" y="3" width="19.5" height="18" rx="3.25" />
      <path d="M8.5 3.5v17" />
      <path
        d="m15.25 7.5 1.3 2.65 2.93.42-2.12 2.07.5 2.92-2.61-1.38-2.62 1.38.5-2.92-2.12-2.07 2.93-.42 1.31-2.65Z"
        fill={pinned ? 'currentColor' : 'none'}
      />
    </svg>
  )
}
