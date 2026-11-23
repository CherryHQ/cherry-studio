import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'

const MicrosoftLight: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 120 120" {...props}>
    <path fill="var(--icon-neutral-background, #FFFFFF)" d="M0 0H120V120H0z" />
    <path fill="#F25022" d="M11.592 4H4V11.5936H11.5936V4H11.592Z" transform="translate(-2.48 -2.48)scale(5.20661)" />
    <path fill="#7FBA00" d="M20 4H12.4064V11.5936H20V4Z" transform="translate(-2.48 -2.48)scale(5.20661)" />
    <path
      fill="#00A4EF"
      d="M11.592 12.4064H4V20H11.5936V12.4064H11.592Z"
      transform="translate(-2.48 -2.48)scale(5.20661)"
    />
    <path fill="#FFB900" d="M20 12.4064H12.4064V20H20V12.4064Z" transform="translate(-2.48 -2.48)scale(5.20661)" />
  </svg>
)

export { MicrosoftLight }

export default MicrosoftLight
