import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'
const Gemini: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 24 24" {...props}>
    <g clipPath="url(#gemini__a)">
      <path
        fill="url(#gemini__b)"
        d="M18 0H6C2.68629 0 0 2.68629 0 6V18C0 21.3137 2.68629 24 6 24H18C21.3137 24 24 21.3137 24 18V6C24 2.68629 21.3137 0 18 0Z"
      />
      <path
        fill="#fff"
        fillOpacity={0.88}
        d="M20 12.0116C15.7043 12.42 12.3692 15.757 11.9995 20C11.652 15.8183 8.20301 12.361 4 12.0181C8.21855 11.6991 11.6656 8.1853 12.006 4C12.2833 8.19653 15.8057 11.7005 20 12.0116Z"
      />
    </g>
    <defs>
      <linearGradient id="gemini__b" x1={-9} x2={19.439} y1={29.5} y2={1.438} gradientUnits="userSpaceOnUse">
        <stop offset={0.193} stopColor="#1C7DFF" />
        <stop offset={0.52} stopColor="#1C69FF" />
        <stop offset={1} stopColor="#F0DCD6" />
      </linearGradient>
      <clipPath id="gemini__a">
        <path fill="#fff" d="M0 0H24V24H0z" />
      </clipPath>
    </defs>
  </svg>
)
export { Gemini }
export default Gemini
