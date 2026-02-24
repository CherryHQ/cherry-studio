import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'
const SkyworkMono: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 80 80" {...props}>
    <g fill="currentColor">
      <path d="M43.884 12.7518C35.413 6.13959 23.1656 6.36227 14.9174 13.8152C5.67392 22.1589 4.95134 36.4195 13.2996 45.6584C20.7525 53.9067 32.9136 55.37 42.0116 49.653L24.4972 30.2663L43.884 12.7518Z" />
      <path
        fillOpacity={0.3}
        d="M37.9897 30.3429C47.0878 24.626 59.2488 26.0847 66.7018 34.3375C75.05 43.581 74.3229 57.8371 65.0839 66.1853C56.8357 73.6382 44.5883 73.8564 36.1174 67.2442L55.5042 49.7297L37.9897 30.3429Z"
      />
    </g>
  </svg>
)
export { SkyworkMono }
export default SkyworkMono
