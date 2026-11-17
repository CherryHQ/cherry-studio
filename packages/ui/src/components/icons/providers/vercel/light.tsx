import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'
const VercelLight: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 120 120" {...props}>
    <path fill="var(--icon-neutral-background, #FFFFFF)" d="M0 0H120V120H0z" />
    <path
      fill="#000"
      fillRule="evenodd"
      d="M57.5 0 115 100H0z"
      clipRule="evenodd"
      style={{
        fill: '#000',
        fillOpacity: 1
      }}
      transform="translate(29.531 27.188)scale(.52989)"
    />
  </svg>
)
export { VercelLight }
export default VercelLight
