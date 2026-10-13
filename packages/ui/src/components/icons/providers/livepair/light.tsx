import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'
const LivepairLight: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="#2563EB" viewBox="0 0 512 512" width="1em" height="1em" {...props}>
    <rect width={210} height={160} x={96} y={128} fillOpacity={0.55} rx={34} />
    <rect width={210} height={160} x={206} y={224} rx={34} />
  </svg>
)
export { LivepairLight }
export default LivepairLight
