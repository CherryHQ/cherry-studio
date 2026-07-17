import { type SVGProps, useId } from 'react'

import type { IconComponent } from '../../types'
const BaichuanLight: IconComponent = (props: SVGProps<SVGSVGElement>) => {
  const iconId = useId()

  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 12 12" {...props}>
      <path
        fill={`url(#${iconId}-baichuanlight__a)`}
        d="M3.6665 1H2.0665L1.0665 3.1665V8.9L0 11H2.6L3.614 8.9L3.6665 1ZM7.3335 1H4.7335V11H7.3335V1ZM8.4 3.8665H11V11H8.4V3.8665ZM11 1H8.4V3.0665H11V1Z"
      />
      <defs>
        <linearGradient
          id={`${iconId}-baichuanlight__a`}
          x1={1.954}
          x2={10.137}
          y1={1.868}
          y2={10.913}
          gradientUnits="userSpaceOnUse">
          <stop stopColor="#FEC13E" />
          <stop offset={1} stopColor="#FF6933" />
        </linearGradient>
      </defs>
    </svg>
  )
}
export { BaichuanLight }
export default BaichuanLight
