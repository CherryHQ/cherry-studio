import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'
const TopxaiLight: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="1em" height="1em" {...props}>
    <path fill="#2458ef" d="M0 0H40V40H0z" />
    <g fill="#fff">
      <path d="M3 4H12L29 28H20L3 4Z" transform="translate(3 4)" />
      <path d="M22 4H31L20 19 15.5 12.6 22 4ZM11.3 18.7 15.8 25.1 13.8 28H4.5L11.3 18.7Z" transform="translate(3 4)" />
    </g>
  </svg>
)
export { TopxaiLight }
export default TopxaiLight
