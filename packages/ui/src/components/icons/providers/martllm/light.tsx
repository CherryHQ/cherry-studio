import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'
const MartllmLight: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="1em" height="1em" {...props}>
    <rect width={32} height={32} fill="#fff" rx={7} />
    <g transform="translate(-3.435 -3.55)scale(1.15)">
      <path
        fill="none"
        stroke="#0a0a0a"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 16h4m0 0 5-5m-5 5 5 5m5-11a3 3 0 1 1 0 6 3 3 0 0 1 0-6Zm0 8a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z"
      />
      <circle cx={10} cy={16} r={2.4} fill="#0a0a0a" />
    </g>
  </svg>
)
export { MartllmLight }
export default MartllmLight
