import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'

const SteadyRouterLight: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 48 48" {...props}>
    <rect width={48} height={48} rx={11} fill="#0f766e" />
    <path d="M32 15 C29 11 17 11 16 18 C15 25 32 21 32 29 C32 37 19 38 15 33" fill="none" stroke="#fff" strokeWidth={5} strokeLinecap="round" />
  </svg>
)

export { SteadyRouterLight }
export default SteadyRouterLight
