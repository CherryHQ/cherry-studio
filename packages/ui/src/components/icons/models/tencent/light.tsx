import { type SVGProps, useId } from 'react'

import type { IconComponent } from '../../types'
const TencentLight: IconComponent = (props: SVGProps<SVGSVGElement>) => {
  const iconId = useId()

  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 12 12" {...props}>
      <g clipPath={`url(#${iconId}-tencentlight__a)`}>
        <path
          fill="#0052D9"
          fillRule="evenodd"
          d="M4.68313 0L12 4.8L6.47635 4.80818L5.07287 12H2.34209L3.74609 4.8H1.17078L0 2.4H4.21409L4.68313 0Z"
          clipRule="evenodd"
        />
      </g>
      <defs>
        <clipPath id={`${iconId}-tencentlight__a`}>
          <path fill="#fff" d="M0 0H12V12H0z" />
        </clipPath>
      </defs>
    </svg>
  )
}
export { TencentLight }
export default TencentLight
