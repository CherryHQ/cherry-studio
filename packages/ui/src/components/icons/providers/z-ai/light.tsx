import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'
const ZAiLight: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 120 120" {...props}>
    <path fill="var(--icon-neutral-background, #FFFFFF)" d="M0 0H120V120H0z" />
    <path
      fill="#000"
      fillRule="evenodd"
      d="M60.7843 33L54.8857 40.9731H29.7685L35.6646 33H60.7871H60.7843ZM90.9797 79.0296L85.0863 87H60.0558L65.9437 79.0296H90.9797ZM93 33L53.09 87H28L67.91 33H93Z"
      clipRule="evenodd"
      transform="matrix(1.27919 0 0 1.27919 -17.39 -16.751)"
    />
  </svg>
)
export { ZAiLight }
export default ZAiLight
