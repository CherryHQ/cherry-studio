import type { SVGProps } from 'react'

export function SidebarCollapseIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <rect x="3.5" y="4" width="17" height="16" rx="4" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8.2 8v8" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
    </svg>
  )
}

export function SidebarExpandIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <rect x="3.5" y="4" width="17" height="16" rx="4" stroke="currentColor" strokeWidth="1.7" />
      <path d="M9.5 5v14" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
    </svg>
  )
}

export function RightSidebarCollapseIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <rect x="3.5" y="4" width="17" height="16" rx="4" stroke="currentColor" strokeWidth="1.7" />
      <path d="M15.8 8v8" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
    </svg>
  )
}

export function RightSidebarExpandIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <rect x="3.5" y="4" width="17" height="16" rx="4" stroke="currentColor" strokeWidth="1.7" />
      <path d="M14.5 5v14" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
    </svg>
  )
}
