import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'

const TencentLight: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 120 120" {...props}>
    <path fill="#EAF2FF" d="M0 0H120V120H0z" />
    <path
      fill="#0052D9"
      fillRule="evenodd"
      d="M10.2442 4L20 10.4L12.6351 10.4109L10.7638 20H7.12278L8.99478 10.4H5.56104L4 7.2H9.61878L10.2442 4Z"
      clipRule="evenodd"
      transform="translate(-2.48 -2.48)scale(5.20661)"
    />
  </svg>
)

export { TencentLight }

export default TencentLight
