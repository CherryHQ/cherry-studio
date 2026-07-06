import type { SVGProps } from 'react'

type WindowIconProps = SVGProps<SVGSVGElement> & {
  /** Pixel size for width/height, matching the lucide-react icon API. */
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

/** Detached sub-window → main window: a window docking back beside a smaller one. */
export function BackToMainWindowIcon({ size = 24, ...props }: WindowIconProps) {
  return (
    <svg width={size} height={size} {...baseProps} {...props}>
      <path d="M20 11V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5" />
      <path d="M8.5 11.5v-2a1 1 0 0 1 1-1h2" />
      <rect x="13" y="13" width="7.5" height="7.5" rx="2" />
    </svg>
  )
}

/** Detach a tab into its own window: a smaller window popping out of a larger one. */
export function OpenInNewWindowIcon({ size = 24, ...props }: WindowIconProps) {
  return (
    <svg width={size} height={size} {...baseProps} {...props}>
      <path d="M21 10V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h6" />
      <rect x="12" y="12.5" width="9" height="7.5" rx="2" />
    </svg>
  )
}
