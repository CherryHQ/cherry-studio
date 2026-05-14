import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'
const StabilityLight: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 120 120" {...props}>
    <path
      fill="url(#stabilitylight__a)"
      d="M64.8797 29.7917V44.7228C60.0417 41.136 52.1174 38.3833 44.3598 38.3833C37.4365 38.3833 33.5994 40.9691 33.5994 45.0564C33.5994 49.394 38.0204 51.1457 46.3618 53.3144C57.289 56.1505 69.1339 59.9042 69.1339 74.0012C69.1339 87.0972 58.8739 95.6888 41.2735 95.6888C31.7643 95.6888 23.3395 93.103 17.2502 88.7655V72.5831C22.839 77.5046 30.5965 81.5084 40.5228 81.5084C48.1969 81.5084 52.5344 78.6723 52.5344 74.168C52.5344 69.33 47.1959 67.7451 38.0204 64.9924C27.0097 61.9061 17 57.652 17 45.4735C17 33.295 27.0097 24.2863 43.6925 24.2863C51.7003 24.2863 59.8749 26.4551 64.8797 29.7917Z"
    />
    <path
      fill="#E80000"
      d="M82.9805 84.6781C82.9805 79.0059 87.318 74.6684 92.9902 74.6684C98.6623 74.6684 103 79.0059 103 84.6781C103 90.3503 98.5789 94.6878 92.9902 94.6878C87.318 94.7712 82.9805 90.2668 82.9805 84.6781Z"
    />
    <defs>
      <linearGradient
        id="stabilitylight__a"
        x1={43.067}
        x2={43.067}
        y1={95.689}
        y2={24.286}
        gradientUnits="userSpaceOnUse">
        <stop stopColor="#A381FF" />
        <stop offset={1} stopColor="#9D38FF" />
      </linearGradient>
    </defs>
  </svg>
)
export { StabilityLight }
export default StabilityLight
