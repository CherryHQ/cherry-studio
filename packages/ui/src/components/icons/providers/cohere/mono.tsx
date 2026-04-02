import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'
const CohereMono: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 24 24" {...props}>
    <g fill="currentColor">
      <path
        fillRule="evenodd"
        d="M7.776 14.304C8.416 14.304 9.696 14.272 11.488 13.536C13.568 12.672 17.664 11.136 20.64 9.536C22.72 8.416 23.616 6.944 23.616 4.96C23.616 2.24 21.408 0 18.656 0H7.136C3.2 0 0 3.2 0 7.136C0 11.072 3.008 14.304 7.776 14.304Z"
        clipRule="evenodd"
      />
      <path
        fillOpacity={0.3}
        fillRule="evenodd"
        d="M9.72803 19.2C9.72803 17.28 10.88 15.52 12.672 14.784L16.288 13.28C19.968 11.776 24 14.464 24 18.432C24 21.504 21.504 24 18.432 24H14.496C11.872 24 9.72803 21.856 9.72803 19.2Z"
        clipRule="evenodd"
      />
      <path
        fillOpacity={0.41}
        d="M4.128 15.2319C1.856 15.2319 0 17.0879 0 19.3599V19.9039C0 22.1439 1.856 23.9999 4.128 23.9999C6.4 23.9999 8.256 22.1439 8.256 19.8719V19.3279C8.224 17.0879 6.4 15.2319 4.128 15.2319Z"
      />
    </g>
  </svg>
)
export { CohereMono }
export default CohereMono
