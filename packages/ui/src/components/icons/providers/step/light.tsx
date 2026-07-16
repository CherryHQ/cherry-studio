import { type SVGProps, useId } from 'react'

import type { IconComponent } from '../../types'
const StepLight: IconComponent = (props: SVGProps<SVGSVGElement>) => {
  const iconId = useId()

  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="9 9 102 102" {...props}>
      <mask
        id={`${iconId}-steplight__a`}
        width={65}
        height={65}
        x={27}
        y={28}
        maskUnits="userSpaceOnUse"
        style={{
          maskType: 'luminance'
        }}>
        <path fill="#fff" d="M92 28H27V93H92V28Z" />
      </mask>
      <g mask={`url(#${iconId}-steplight__a)`}>
        <mask
          id={`${iconId}-steplight__b`}
          width={65}
          height={65}
          x={27}
          y={28}
          maskUnits="userSpaceOnUse"
          style={{
            maskType: 'luminance'
          }}>
          <path fill="#fff" d="M92 28H27V93H92V28Z" />
        </mask>
        <g mask={`url(#${iconId}-steplight__b)`}>
          <path
            fill={`url(#${iconId}-steplight__c)`}
            fillRule="evenodd"
            d="M86.6158 28H89.4108V30.5107H92V33.1323H89.4108V38.2375H86.6158V33.135H81.5296V30.5079H86.6158V28ZM34.0417 61.5048V33.0646H36.666V61.5075H34.039L34.0417 61.5048ZM62.2706 63.2923H91.9267V65.7785H75.1135V91.7219H62.2706V63.2896V63.2923ZM42.2452 37.0269V70.491H27V82.7057H55.1287V49.6667H83.4931L83.485 37.0242L42.2452 37.0269Z"
            clipRule="evenodd"
          />
        </g>
      </g>
      <defs>
        <linearGradient
          id={`${iconId}-steplight__c`}
          x1={31.458}
          x2={76.676}
          y1={33.189}
          y2={87.83}
          gradientUnits="userSpaceOnUse">
          <stop stopColor="#01A9FF" />
          <stop offset={1} stopColor="#0160FF" />
        </linearGradient>
      </defs>
    </svg>
  )
}
export { StepLight }
export default StepLight
