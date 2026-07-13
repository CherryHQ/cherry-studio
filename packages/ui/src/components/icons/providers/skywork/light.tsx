import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'
const SkyworkLight: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="-3 -3 29 29" {...props}>
    <path
      fill="#4D5EFF"
      d="M12.5909 1.644C9.66113 -0.642247 5.42463 -0.565996 2.57232 2.01104C-0.625071 4.89825 -0.875796 9.83 2.01142 13.0261C4.58845 15.8797 8.7952 16.3851 11.9422 14.4077L5.88473 7.7015L12.5909 1.644Z"
    />
    <path
      fill="#00FFCE"
      d="M9.90462 20.3558C12.8344 22.6421 17.0709 22.5658 19.9232 19.9888C23.1193 17.1016 23.37 12.1698 20.4828 8.97371C17.9058 6.12011 13.6991 5.61479 10.5521 7.59211L16.6095 14.2984L9.90332 20.3558H9.90462Z"
    />
  </svg>
)
export { SkyworkLight }
export default SkyworkLight
