import { type SVGProps, useId } from 'react'

import type { IconComponent } from '../../types'
const KlingLight: IconComponent = (props: SVGProps<SVGSVGElement>) => {
  const iconId = useId()

  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 12 12" {...props}>
      <g clipPath={`url(#${iconId}-klinglight__a)`}>
        <path
          fill={`url(#${iconId}-klinglight__b)`}
          d="M2.70602 6.63751C2.95972 5.86193 3.29458 5.11529 3.70502 4.41001C5.29002 1.66401 7.60252 0.0315115 8.87002 0.763012C6.01902 -0.882988 2.29902 0.222012 0.56102 3.23201C0.353593 3.59113 0.180012 3.96875 0.0425202 4.36001C-0.0869798 4.72951 0.0885203 5.12701 0.42752 5.32301L2.70602 6.63801V6.63751Z"
        />
        <path
          fill={`url(#${iconId}-klinglight__c)`}
          d="M9.29402 4.83202C9.04017 5.60762 8.70515 6.35426 8.29452 7.05952C6.70952 9.80552 4.39702 11.4385 3.12952 10.7065C5.98102 12.353 9.70102 11.2475 11.439 8.23752C11.6464 7.87854 11.82 7.50109 11.9575 7.11002C12.087 6.74102 11.9115 6.34302 11.5725 6.14752L9.29402 4.83252V4.83202Z"
        />
        <path
          fill={`url(#${iconId}-klinglight__d)`}
          d="M8.29502 7.06002C9.88002 4.31402 10.138 1.49502 8.87002 0.763017C7.60352 0.0315172 5.29102 1.66502 3.70502 4.41002C4.74202 2.61502 6.60952 1.75252 7.87702 2.48402C9.14402 3.21602 9.33102 5.26402 8.29452 7.05952L8.29502 7.06002Z"
        />
        <path
          fill={`url(#${iconId}-klinglight__e)`}
          d="M3.70499 4.41002C2.11999 7.15602 1.86199 9.97502 3.12999 10.7065C4.39699 11.4385 6.70949 9.80552 8.29499 7.05952C7.25799 8.85502 5.39049 9.71752 4.12299 8.98552C2.85599 8.25402 2.66899 6.20552 3.70549 4.41052L3.70499 4.41002Z"
        />
      </g>
      <defs>
        <radialGradient
          id={`${iconId}-klinglight__b`}
          cx={0}
          cy={0}
          r={1}
          gradientTransform="matrix(3.73886 -6.2551 8.57184 5.12364 2.587 6.569)"
          gradientUnits="userSpaceOnUse">
          <stop offset={0.095} stopColor="#FFF959" />
          <stop offset={0.326} stopColor="#0DF35E" />
          <stop offset={0.64} stopColor="#0BF2F9" />
          <stop offset={1} stopColor="#04A6F0" />
        </radialGradient>
        <radialGradient
          id={`${iconId}-klinglight__c`}
          cx={0}
          cy={0}
          r={1}
          gradientTransform="rotate(120.868 3.316 5.12)scale(7.28735 9.9864)"
          gradientUnits="userSpaceOnUse">
          <stop offset={0.095} stopColor="#FFF959" />
          <stop offset={0.326} stopColor="#0DF35E" />
          <stop offset={0.64} stopColor="#0BF2F9" />
          <stop offset={1} stopColor="#04A6F0" />
        </radialGradient>
        <linearGradient
          id={`${iconId}-klinglight__d`}
          x1={7.789}
          x2={9.031}
          y1={0.649}
          y2={4.681}
          gradientUnits="userSpaceOnUse">
          <stop stopColor="#003EFF" />
          <stop offset={1} stopColor="#0BFFE7" />
        </linearGradient>
        <linearGradient
          id={`${iconId}-klinglight__e`}
          x1={4.211}
          x2={2.969}
          y1={10.821}
          y2={6.79}
          gradientUnits="userSpaceOnUse">
          <stop stopColor="#003EFF" />
          <stop offset={1} stopColor="#0BFFE7" />
        </linearGradient>
        <clipPath id={`${iconId}-klinglight__a`}>
          <path fill="#fff" d="M0 0H12V12H0z" />
        </clipPath>
      </defs>
    </svg>
  )
}
export { KlingLight }
export default KlingLight
