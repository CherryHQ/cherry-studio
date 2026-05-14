import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'
const BaichuanLight: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 120 120" {...props}>
    <path
      fill="url(#baichuanlight__a)"
      d="M43.2766 24.1665H31.8099L24.6432 39.6931V80.7832L17 95.8332H35.6333L42.9003 80.7832L43.2766 24.1665ZM69.5567 24.1665H50.9234V95.8332H69.5567V24.1665ZM77.2 44.7098H95.8333V95.8332H77.2V44.7098ZM95.8333 24.1665H77.2V38.9764H95.8333V24.1665Z"
    />
    <defs>
      <linearGradient
        id="baichuanlight__a"
        x1={31.004}
        x2={89.645}
        y1={30.386}
        y2={95.212}
        gradientUnits="userSpaceOnUse">
        <stop stopColor="#FEC13E" />
        <stop offset={1} stopColor="#FF6933" />
      </linearGradient>
    </defs>
  </svg>
)
export { BaichuanLight }
export default BaichuanLight
