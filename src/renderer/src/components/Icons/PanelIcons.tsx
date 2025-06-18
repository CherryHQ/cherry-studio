import { SVGProps } from 'react'

interface PanelIconProps extends Omit<SVGProps<SVGSVGElement>, 'width' | 'height'> {
  size?: number | string
  expanded?: boolean
}

export const PanelLeftIcon = ({ size = 18, expanded = false, ...props }: PanelIconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    className="lucide lucide-panel-left-icon lucide-panel-left"
    {...props}>
    <rect width="18" height="18" x="3" y="3" rx="2" />
    {expanded ? <path d="M10 7v10" strokeWidth={4} /> : <path d="M9 6v12" strokeWidth={2} />}
  </svg>
)

export const PanelRightIcon = ({ size = 18, expanded = false, ...props }: PanelIconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    className="lucide lucide-panel-right-icon lucide-panel-right"
    {...props}>
    <rect width="18" height="18" x="3" y="3" rx="2" />
    {expanded ? <path d="M14 7v10" strokeWidth={4} /> : <path d="M15 6v12" strokeWidth={2} />}
  </svg>
)
