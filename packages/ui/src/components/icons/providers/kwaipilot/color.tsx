import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'
const Kwaipilot: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 29 29" {...props}>
    <path
      fill="url(#kwaipilot__a)"
      d="M14.6018 0.611685C6.87033 0.611685 0.601562 6.88035 0.601562 14.6117C0.601562 18.8326 2.47059 22.617 5.42388 25.1848L12.3497 10.9828H20.0974L11.6532 28.2983C12.6051 28.5026 13.5895 28.6094 14.6018 28.6094C22.3333 28.6094 28.6021 22.3407 28.6021 14.6094C28.6021 6.87803 22.3333 0.609375 14.6018 0.609375V0.611685Z"
    />
    <path
      fill="url(#kwaipilot__b)"
      d="M5.42388 25.1825L13.0648 9.51551C13.0857 9.4714 13.1066 9.42728 13.1298 9.38317L13.2343 9.16725H13.2389C14.5925 6.6296 17.2649 4.90224 20.3412 4.90224C23.6846 4.90224 26.552 6.94303 27.7686 9.84519C25.8206 4.45879 20.6593 0.609375 14.6018 0.609375C6.87033 0.609375 0.601562 6.87803 0.601562 14.6094C0.601562 18.8303 2.47059 22.6147 5.42388 25.1825Z"
    />
    <defs>
      <linearGradient id="kwaipilot__a" x1={16.648} x2={15.554} y1={6.368} y2={26.16} gradientUnits="userSpaceOnUse">
        <stop offset={0.313} stopColor="#9EC0E0" />
        <stop offset={1} stopColor="#fff" />
      </linearGradient>
      <linearGradient id="kwaipilot__b" x1={16.972} x2={7.255} y1={5.654} y2={21.457} gradientUnits="userSpaceOnUse">
        <stop stopColor="#fff" />
        <stop offset={1} stopColor="#BCD5EC" />
      </linearGradient>
    </defs>
  </svg>
)
export { Kwaipilot }
export default Kwaipilot
