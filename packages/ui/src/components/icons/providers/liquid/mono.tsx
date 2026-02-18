import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'
const LiquidMono: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 32 32" {...props}>
    <path
      fill="currentColor"
      d="M0 0 C4.29 1.43 5.06 3.9 7.31 7.75 C8.05 8.98 8.79 10.21 9.55 11.48 C11 15 11 15 10.36 17.7 C9.68 18.84 9.68 18.84 9 20 C8.34 21.32 7.68 22.64 7 24 C3.04 24 -0.92 24 -5 24 C-8.32 19.02 -8.32 19.02 -9 17 C-7.85 12.89 -5.54 9.34 -3.38 5.69 C-2.74 4.62 -2.11 3.55 -1.46 2.45 C-0.98 1.64 -0.5 0.83 0 0 Z M0 10 C-2.15 13.23 -2.2 14.28 -2 18 C-0.02 18.99 -0.02 18.99 2 20 C2.99 19.01 3.98 18.02 5 17 C3.6 13.45 3.6 13.45 2 10 C1.34 10 0.68 10 0 10 Z"
      transform="translate(15 4)"
    />
  </svg>
)
export { LiquidMono }
export default LiquidMono
