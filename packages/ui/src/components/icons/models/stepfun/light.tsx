import { type SVGProps, useId } from 'react'

import type { IconComponent } from '../../types'
const StepfunLight: IconComponent = (props: SVGProps<SVGSVGElement>) => {
  const iconId = useId()

  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 24 24" {...props}>
      <path
        fill={`url(#${iconId}-stepfunlight__a)`}
        fillRule="evenodd"
        d="M18.6747 4H19.3627V4.6304H20V5.28868H19.3627V6.57055H18.6747V5.28936H17.4227V4.62972H18.6747V4ZM5.73333 12.4128V5.27168H6.37933V12.4135H5.73267L5.73333 12.4128ZM12.682 12.8616H19.982V13.4859H15.8433V20H12.682V12.8609V12.8616ZM7.75267 6.26658V14.6692H4V17.7361H10.924V9.44033H17.906L17.904 6.2659L7.75267 6.26658Z"
        clipRule="evenodd"
      />
      <defs>
        <linearGradient
          id={`${iconId}-stepfunlight__a`}
          x1={5.097}
          x2={16.491}
          y1={5.303}
          y2={18.8}
          gradientUnits="userSpaceOnUse">
          <stop stopColor="#01A9FF" />
          <stop offset={1} stopColor="#0160FF" />
        </linearGradient>
      </defs>
    </svg>
  )
}
export { StepfunLight }
export default StepfunLight
