import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'
const SunoLight: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 24 24" {...props}>
    <path
      fill="#000"
      fillRule="evenodd"
      d="M15 4C17.7613 4 20 7.582 20 12H14C14 16.418 11.7613 20 9 20C6.23867 20 4 16.418 4 12H10C10 7.582 12.2387 4 15 4Z"
      clipRule="evenodd"
    />
  </svg>
)
export { SunoLight }
export default SunoLight
