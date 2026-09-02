import { type SVGProps, useId } from 'react'

import type { IconComponent } from '../../types'
const TokendanceLight: IconComponent = (props: SVGProps<SVGSVGElement>) => {
  const iconId = useId()

  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 480 480" {...props}>
      <g clipPath={`url(#${iconId}-tokendancelight__a)`}>
        <path fill="#000" d="M0 0H480V480H0z" />
        <path
          fill="#fff"
          d="M159 162H52.789C51.4198 162 50.4555 160.655 50.8947 159.358L66.8591 112.225C69.3344 104.918 76.192 100 83.9077 100H321.388C324.459 100 327.524 100.21 330.551 100.726C336.545 101.747 347.179 103.791 354.5 106.5C395.04 121.504 418.5 160 426 191C433.5 222 432 274.5 390.5 327C349 379.5 284 380.5 282 380.5H175.767C174.399 380.5 173.451 379.159 173.886 377.863L192.567 322.275C193.123 320.623 194.677 319.52 196.42 319.545C207.729 319.703 230.558 319.865 251 319.5C279 319 286 318.5 310 305.5C334 292.5 360.5 252.5 352 209.5C345.2 175.1 315.5 163.5 301.5 162H228.992C221.236 162 214.351 166.969 211.908 174.331L147.592 368.169C145.149 375.531 138.264 380.5 130.508 380.5H73.7532C72.3943 380.5 71.4179 379.214 71.8379 377.922C89.6259 323.19 124.669 214.961 129 200C133.4 184.8 150.833 168.333 159 162Z"
        />
        <path stroke="#fff" strokeLinecap="round" strokeWidth={25} d="M233 264 248 216M280 264 295 216" />
      </g>
      <defs>
        <clipPath id={`${iconId}-tokendancelight__a`}>
          <rect width={480} height={480} fill="#fff" rx={80} />
        </clipPath>
      </defs>
    </svg>
  )
}
export { TokendanceLight }
export default TokendanceLight
