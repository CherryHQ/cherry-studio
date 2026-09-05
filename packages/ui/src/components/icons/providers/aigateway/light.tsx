import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'
const AigatewayLight: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    aria-label="AIgateway"
    viewBox="0 0 32 32"
    {...props}>
    <rect width={30} height={30} x={1} y={1} fill="#fdfcf9" stroke="#d8d4ce" rx={7} />
    <path stroke="#110f0d" strokeLinecap="round" strokeWidth={2} d="M8 11 22 11" transform="rotate(-22 16 11)" />
    <path stroke="#00a23f" strokeLinecap="round" strokeWidth={2} d="M8 21 22 21" transform="rotate(22 16 21)" />
  </svg>
)
export { AigatewayLight }
export default AigatewayLight
