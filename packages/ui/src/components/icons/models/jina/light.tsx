import { type SVGProps, useId } from 'react'

import type { IconComponent } from '../../types'
const JinaLight: IconComponent = (props: SVGProps<SVGSVGElement>) => {
  const iconId = useId()

  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 12 12" {...props}>
      <g clipPath={`url(#${iconId}-jinalight__a)`}>
        <path
          fill="#000"
          fillRule="evenodd"
          d="M2.76503 11.9526C3.49836 11.9526 4.20166 11.6537 4.7202 11.1217C5.23875 10.5896 5.53006 9.868 5.53006 9.11558C5.53006 8.36316 5.23875 7.64155 4.7202 7.1095C4.20166 6.57746 3.49836 6.27856 2.76503 6.27856C2.0317 6.27856 1.3284 6.57746 0.809859 7.1095C0.291315 7.64155 0 8.36316 0 9.11558C0 9.868 0.291315 10.5896 0.809859 11.1217C1.3284 11.6537 2.0317 11.9526 2.76503 11.9526ZM11.3364 0.00923415C11.7048 0.00923415 12 0.312112 12 0.690094V6.23178C12 9.38983 9.51126 11.9624 6.46994 12V6.24101L6.45194 0.68086C6.45194 0.302878 6.74653 0 7.11552 0H11.4102L11.3364 0.00923415Z"
          clipRule="evenodd"
        />
      </g>
      <defs>
        <clipPath id={`${iconId}-jinalight__a`}>
          <path fill="#fff" d="M0 0H12V12H0z" />
        </clipPath>
      </defs>
    </svg>
  )
}
export { JinaLight }
export default JinaLight
