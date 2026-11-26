import { type SVGProps, useId } from 'react'

import type { IconComponent } from '../../types'
const MorseDark: IconComponent = (props: SVGProps<SVGSVGElement>) => {
  const iconId = useId()

  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="-12 -12 24 24" width="1em" height="1em" {...props}>
      <defs>
        <radialGradient id={`${iconId}-morsedark__a`} cx={-3.3} cy={-2} r={11} gradientUnits="userSpaceOnUse">
          <stop offset={0} stopColor="#fff" />
          <stop offset={0.55} stopColor="#e5efff" />
          <stop offset={1} stopColor="#a1bff2" />
        </radialGradient>
        <radialGradient id={`${iconId}-morsedark__b`} cx={3.3} cy={2} r={11} gradientUnits="userSpaceOnUse">
          <stop offset={0} stopColor="#c5d8f9" />
          <stop offset={0.55} stopColor="#80a5e7" />
          <stop offset={1} stopColor="#527bc3" />
        </radialGradient>
      </defs>
      <path fill={`url(#${iconId}-morsedark__a)`} d="M-0.8 -12C-0.8 -7 -5.8 -2 -10.8 -2C-5.8 -2 -0.8 3 -0.8 8Z" />
      <path fill={`url(#${iconId}-morsedark__b)`} d="M0.8 -8C0.8 -3 5.8 2 10.8 2C5.8 2 0.8 7 0.8 12Z" />
    </svg>
  )
}
export { MorseDark }
export default MorseDark
