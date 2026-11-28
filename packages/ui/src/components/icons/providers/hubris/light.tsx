import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'
const HubrisLight: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" width="1em" height="1em" {...props}>
    <g stroke="#8B6BFF" strokeWidth={0.7} opacity={0.4}>
      <path d="M12 12 12 3.5M12 12 20.5 12M12 12 12 20.5M12 12 3.5 12" />
    </g>
    <g stroke="#8B6BFF" strokeWidth={0.7} opacity={0.3}>
      <path d="M12 12 18.5 5.5M12 12 18.5 18.5M12 12 5.5 18.5M12 12 5.5 5.5" />
    </g>
    <g fill="#8B6BFF">
      <circle cx={12} cy={12} r={2.4} />
      <circle cx={12} cy={3.5} r={1.4} opacity={0.85} />
      <circle cx={20.5} cy={12} r={1.4} opacity={0.85} />
      <circle cx={12} cy={20.5} r={1.4} opacity={0.85} />
      <circle cx={3.5} cy={12} r={1.4} opacity={0.85} />
      <circle cx={18.5} cy={5.5} r={1.1} opacity={0.6} />
      <circle cx={18.5} cy={18.5} r={1.1} opacity={0.6} />
      <circle cx={5.5} cy={18.5} r={1.1} opacity={0.6} />
      <circle cx={5.5} cy={5.5} r={1.1} opacity={0.6} />
    </g>
  </svg>
)
export { HubrisLight }
export default HubrisLight
