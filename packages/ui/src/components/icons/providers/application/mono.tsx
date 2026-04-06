import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'

const ApplicationMono: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 32 32" {...props}>
    <rect width="12" height="12" x="2" y="2" rx="3" fill="currentColor" />
    <rect width="12" height="12" x="18" y="2" rx="3" fill="currentColor" />
    <rect width="12" height="12" x="2" y="18" rx="3" fill="currentColor" />
    <circle cx="24" cy="24" r="6" fill="currentColor" />
  </svg>
)

export { ApplicationMono }
export default ApplicationMono
