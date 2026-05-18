import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'
const ApplicationLight: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="1 1 30 30" {...props}>
    <rect width={12} height={12} x={2} y={2} fill="#2BA471" rx={3} />
    <rect width={12} height={12} x={18} y={2} fill="#1B8A5A" rx={3} />
    <rect width={12} height={12} x={2} y={18} fill="#2BA471" rx={3} />
    <circle cx={24} cy={24} r={6} fill="#0E5C3A" />
  </svg>
)
export { ApplicationLight }
export default ApplicationLight
