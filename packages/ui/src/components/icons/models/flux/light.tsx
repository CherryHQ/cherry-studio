import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'
const FluxLight: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 12 12" {...props}>
    <path
      fill="#000"
      fillRule="evenodd"
      d="M0 10.0915L6.005 1L12 10.0915H10.8835L6.0045 2.689L1.7355 9.153H7.7965L8.416 10.0915H0Z"
      clipRule="evenodd"
    />
    <path
      fill="#000"
      fillRule="evenodd"
      d="M4.0345 8.11201L5.071 6.55451L6.108 8.11201H4.0345ZM9.12 10.0915L6.286 5.73801H7.3745L10.2175 10.0915H9.12ZM9.87 5.58801L10.935 3.99301L12 5.58801H9.87Z"
      clipRule="evenodd"
    />
  </svg>
)
export { FluxLight }
export default FluxLight
