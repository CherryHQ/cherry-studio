import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'
const UberllmLight: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 32 32" {...props}>
    <rect width={32} height={32} fill="#5B4EE6" rx={8} />
    <path
      stroke="#fff"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.7}
      d="M9 16h4m0 0 5-5m-5 5 5 5m5-11a3 3 0 1 1 0 6 3 3 0 0 1 0-6Zm0 8a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z"
    />
    <circle cx={10} cy={16} r={2.2} fill="#fff" />
  </svg>
)
export { UberllmLight }
export default UberllmLight
