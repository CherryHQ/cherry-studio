import { type SVGProps, useId } from 'react'

import type { IconComponent } from '../../types'
const KimiDark: IconComponent = (props: SVGProps<SVGSVGElement>) => {
  const iconId = useId()

  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 12 12" {...props}>
      <g fillRule="evenodd" clipPath={`url(#${iconId}-kimidark__a)`} clipRule="evenodd">
        <path
          fill="#027AFF"
          d="M9.74145 2.55106C9.82849 2.4394 9.9049 2.33739 9.98554 2.23864C10.023 2.19216 10.0197 2.15681 9.98337 2.10827C9.63353 1.64836 9.60045 1.13773 9.80181 0.619622C9.95295 0.229712 10.2873 0.0469658 10.6959 0.00807325C10.9507 -0.0159515 11.2007 0.0101411 11.4325 0.134007C11.737 0.296961 11.9142 0.545381 11.9719 0.888227C12.0179 1.16175 12.0093 1.42878 11.9319 1.69375C11.7946 2.16272 11.4575 2.40573 10.9956 2.46717C10.6121 2.51847 10.2232 2.52487 9.83646 2.55106C9.80663 2.55322 9.77611 2.55106 9.74145 2.55106Z"
        />
        <path
          fill="#fff"
          d="M8.79297 0.450668H6.48226L4.65283 4.62232H2.06662V0.468884H0V11.2167H2.06711V6.68884H5.71209C6.33969 6.68884 6.91273 6.32296 7.1772 5.75414V11.2167H9.24432V6.68884C9.24432 5.61157 8.40247 4.70561 7.32785 4.62714V4.62172H6.19278C6.46631 4.52838 6.71758 4.37961 6.93105 4.18485C7.14461 3.98999 7.31564 3.75329 7.4336 3.48941L8.79297 0.450668Z"
        />
      </g>
      <defs>
        <clipPath id={`${iconId}-kimidark__a`}>
          <path fill="#fff" d="M0 0H12V12H0z" />
        </clipPath>
      </defs>
    </svg>
  )
}
export { KimiDark }
export default KimiDark
