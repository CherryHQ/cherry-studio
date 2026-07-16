import { type SVGProps, useId } from 'react'

import type { IconComponent } from '../../types'
const KlingLight: IconComponent = (props: SVGProps<SVGSVGElement>) => {
  const iconId = useId()

  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="9 9 102 102" {...props}>
      <mask
        id={`${iconId}-klinglight__a`}
        width={65}
        height={65}
        x={28}
        y={27}
        maskUnits="userSpaceOnUse"
        style={{
          maskType: 'luminance'
        }}>
        <path fill="#fff" d="M93 27H28V92H93V27Z" />
      </mask>
      <g mask={`url(#${iconId}-klinglight__a)`}>
        <path
          fill={`url(#${iconId}-klinglight__b)`}
          d="M42.6564 64.3072C44.0306 60.1062 45.8444 56.0619 48.0676 52.2416C56.6531 37.3674 69.1791 28.5247 76.0448 32.4871C60.6018 23.5712 40.4518 29.5566 31.0376 45.8608C29.9141 47.806 28.9739 49.8514 28.2291 51.9708C27.5276 53.9722 28.4783 56.1254 30.3146 57.1871L42.6564 64.3099V64.3072Z"
        />
        <path
          fill={`url(#${iconId}-klinglight__c)`}
          d="M78.3429 54.5275C76.968 58.7287 75.1533 62.7731 72.929 66.5932C64.3436 81.4673 51.8176 90.313 44.9519 86.3477C60.3976 95.2666 80.5476 89.2782 89.9617 72.974C91.0847 71.0296 92.025 68.985 92.7702 66.8667C93.4716 64.8679 92.5208 62.7121 90.6848 61.6532L78.3429 54.5302V54.5275Z"
        />
        <path
          fill={`url(#${iconId}-klinglight__d)`}
          d="M72.9307 66.5958C81.5161 51.7216 82.9136 36.4521 76.0453 32.4871C69.1851 28.5247 56.659 37.3729 48.0682 52.2416C53.6853 42.5187 63.8009 37.8468 70.6665 41.8091C77.5295 45.7741 78.5424 56.8674 72.928 66.5931L72.9307 66.5958Z"
        />
        <path
          fill={`url(#${iconId}-klinglight__e)`}
          d="M48.0697 52.2416C39.4843 67.1158 38.0868 82.3854 44.9552 86.3477C51.818 90.313 64.3441 81.4673 72.9322 66.5931C67.3152 76.3187 57.1995 80.9906 50.3339 77.0256C43.471 73.0633 42.458 61.9673 48.0725 52.2443L48.0697 52.2416Z"
        />
      </g>
      <defs>
        <radialGradient
          id={`${iconId}-klinglight__b`}
          cx={0}
          cy={0}
          r={1}
          gradientTransform="rotate(-59.132 77.354 -5.06)scale(39.4731 54.093)"
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
          gradientTransform="matrix(-20.25215 33.8818 -46.43081 -27.75306 78.988 54.901)"
          gradientUnits="userSpaceOnUse">
          <stop offset={0.095} stopColor="#FFF959" />
          <stop offset={0.326} stopColor="#0DF35E" />
          <stop offset={0.64} stopColor="#0BF2F9" />
          <stop offset={1} stopColor="#04A6F0" />
        </radialGradient>
        <linearGradient
          id={`${iconId}-klinglight__d`}
          x1={70.19}
          x2={76.917}
          y1={31.87}
          y2={53.707}
          gradientUnits="userSpaceOnUse">
          <stop stopColor="#003EFF" />
          <stop offset={1} stopColor="#0BFFE7" />
        </linearGradient>
        <linearGradient
          id={`${iconId}-klinglight__e`}
          x1={50.81}
          x2={44.083}
          y1={86.968}
          y2={65.131}
          gradientUnits="userSpaceOnUse">
          <stop stopColor="#003EFF" />
          <stop offset={1} stopColor="#0BFFE7" />
        </linearGradient>
      </defs>
    </svg>
  )
}
export { KlingLight }
export default KlingLight
