import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'
const DalleLight: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    style={{
      flex: 'none',
      lineHeight: 1
    }}
    viewBox="0 9 24 7"
    {...props}>
    <path fill="#FFFF67" d="M0 10h4.8v5H0z" />
    <path fill="#43FFFF" d="M4.8 10h4.8v5H4.8z" />
    <path fill="#51DA4B" d="M9.6 10h4.8v5H9.6z" />
    <path fill="#FF6E3D" d="M14.4 10h4.8v5h-4.8z" />
    <path fill="#3C46FF" d="M19.2 10H24v5h-4.8z" />
  </svg>
)
export { DalleLight }
export default DalleLight
