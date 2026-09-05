import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'
const AigatewayDark: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    aria-label="AIgateway"
    viewBox="0 0 32 32"
    {...props}>
    <rect width={30} height={30} x={1} y={1} fill="none" stroke="currentColor" strokeOpacity={0.45} rx={7} />
    <path stroke="currentColor" strokeLinecap="round" strokeWidth={2} d="M8 11 22 11" transform="rotate(-22 16 11)" />
    <path stroke="currentColor" strokeLinecap="round" strokeWidth={2} d="M8 21 22 21" transform="rotate(22 16 21)" />
  </svg>
)
export { AigatewayDark }
export default AigatewayDark
