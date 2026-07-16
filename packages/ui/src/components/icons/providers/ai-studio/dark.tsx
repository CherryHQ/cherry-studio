import { type SVGProps, useId } from 'react'

import type { IconComponent } from '../../types'
const AiStudioDark: IconComponent = (props: SVGProps<SVGSVGElement>) => {
  const iconId = useId()

  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="9 9 102 102" {...props}>
      <mask
        id={`${iconId}-aistudiodark__a`}
        width={80}
        height={80}
        x={20}
        y={20}
        maskUnits="userSpaceOnUse"
        style={{
          maskType: 'luminance'
        }}>
        <path fill="#fff" d="M100 20H20V100H100V20Z" />
        <path
          fill="#000"
          d="M71.5625 64.5313C81.0549 64.5313 88.75 56.8362 88.75 47.3438C88.75 37.8514 81.0549 30.1562 71.5625 30.1562C62.0701 30.1562 54.375 37.8514 54.375 47.3438C54.375 56.8362 62.0701 64.5313 71.5625 64.5313Z"
        />
      </mask>
      <g mask={`url(#${iconId}-aistudiodark__a)`}>
        <path
          stroke="#fff"
          strokeLinejoin="round"
          strokeWidth={6.016}
          d="M75.1592 38.9091H42.6592C40.5882 38.9091 38.9092 40.588 38.9092 42.6591V75.1591C38.9092 77.2301 40.5882 78.9091 42.6592 78.9091H75.1592C77.2303 78.9091 78.9092 77.2301 78.9092 75.1591V42.6591C78.9092 40.588 77.2303 38.9091 75.1592 38.9091Z"
        />
      </g>
      <path
        fill="#fff"
        d="M71.5625 30.625C71.5625 30.625 69.6875 38.4375 67.1875 40.9375C64.6875 43.4375 56.875 45.3125 56.875 45.3125C56.875 45.3125 64.6875 47.1875 67.1875 49.6875C69.6875 52.1875 71.5625 60 71.5625 60C71.5625 60 73.4375 52.1875 75.9375 49.6875C78.4375 47.1875 86.2501 45.3125 86.2501 45.3125C86.2501 45.3125 78.4375 43.4375 75.9375 40.9375C73.4375 38.4375 71.5625 30.625 71.5625 30.625Z"
      />
    </svg>
  )
}
export { AiStudioDark }
export default AiStudioDark
