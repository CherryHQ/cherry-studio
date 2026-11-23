import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'

const ElevenlabsLight: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 120 120" {...props}>
    <path fill="var(--icon-neutral-background, #FFFFFF)" d="M0 0H120V120H0z" />
    <path
      fill="#000"
      fillRule="evenodd"
      d="M41 27H54.5714V92H41V27ZM65.4286 27H79V92H65.4286V27Z"
      clipRule="evenodd"
      transform="matrix(1.27919 0 0 1.27919 -16.751 -16.112)"
    />
  </svg>
)

export { ElevenlabsLight }

export default ElevenlabsLight
