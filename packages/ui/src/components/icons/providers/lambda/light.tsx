import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'
const LambdaLight: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="17.5 17.5 85 85" {...props}>
    <g clipPath="url(#lambdalight__a)">
      <path fill="#000" d="M101.5 18.5H18.5V101.5H101.5V18.5Z" />
      <mask
        id="lambdalight__b"
        width={64}
        height={64}
        x={28}
        y={28}
        maskUnits="userSpaceOnUse"
        style={{
          maskType: 'luminance'
        }}>
        <path fill="#fff" d="M91.125 28.875H28.875V91.125H91.125V28.875Z" />
      </mask>
      <g fill="#fff" mask="url(#lambdalight__b)">
        <path d="M45.0346 39.7187L55.8661 58.6988L43.8145 80.6793L51.5708 80.673L59.6011 65.677L68.1542 80.6793H76.06L52.9403 39.7125L45.0346 39.7187Z" />
        <path d="M28.875 28.875V91.125H91.125V28.875H28.875ZM85.6283 85.6448H34.3717V34.3552H85.6283V85.6448Z" />
      </g>
    </g>
    <defs>
      <clipPath id="lambdalight__a">
        <path fill="#fff" d="M0 0H83V83H0z" transform="translate(18.5 18.5)" />
      </clipPath>
    </defs>
  </svg>
)
export { LambdaLight }
export default LambdaLight
