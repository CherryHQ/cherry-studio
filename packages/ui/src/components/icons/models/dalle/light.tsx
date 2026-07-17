import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'
const DalleLight: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 12 12" {...props}>
    <path fill="#FFFF67" d="M0 5H2.4V7.5H0V5Z" />
    <path fill="#43FFFF" d="M2.4 5H4.8V7.5H2.4V5Z" />
    <path fill="#51DA4B" d="M4.8 5H7.2V7.5H4.8V5Z" />
    <path fill="#FF6E3D" d="M7.2 5H9.6V7.5H7.2V5Z" />
    <path fill="#3C46FF" d="M9.6 5H12V7.5H9.6V5Z" />
  </svg>
)
export { DalleLight }
export default DalleLight
