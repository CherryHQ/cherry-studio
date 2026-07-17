import { type SVGProps, useId } from 'react'

import type { IconComponent } from '../../types'
const StepfunLight: IconComponent = (props: SVGProps<SVGSVGElement>) => {
  const iconId = useId()

  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 12 12" {...props}>
      <g clipPath={`url(#${iconId}-stepfunlight__a)`}>
        <path
          fill={`url(#${iconId}-stepfunlight__b)`}
          fillRule="evenodd"
          d="M11.006 0H11.522V0.4635H12V0.9475H11.522V1.89H11.006V0.948H10.067V0.463H11.006V0ZM1.3 6.1855V0.935H1.7845V6.186H1.2995L1.3 6.1855ZM6.5115 6.5155H11.9865V6.9745H8.8825V11.764H6.5115V6.515V6.5155ZM2.8145 1.6665V7.8445H0V10.0995H5.193V4H10.4295L10.428 1.666L2.8145 1.6665Z"
          clipRule="evenodd"
        />
      </g>
      <defs>
        <linearGradient
          id={`${iconId}-stepfunlight__b`}
          x1={0.823}
          x2={9.171}
          y1={0.958}
          y2={11.046}
          gradientUnits="userSpaceOnUse">
          <stop stopColor="#01A9FF" />
          <stop offset={1} stopColor="#0160FF" />
        </linearGradient>
        <clipPath id={`${iconId}-stepfunlight__a`}>
          <path fill="#fff" d="M0 0H12V12H0z" />
        </clipPath>
      </defs>
    </svg>
  )
}
export { StepfunLight }
export default StepfunLight
