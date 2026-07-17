import { type SVGProps, useId } from 'react'

import type { IconComponent } from '../../types'
const SunoDark: IconComponent = (props: SVGProps<SVGSVGElement>) => {
  const iconId = useId()

  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 12 12" {...props}>
      <g clipPath={`url(#${iconId}-sunodark__a)`}>
        <path
          fill="#fff"
          fillRule="evenodd"
          d="M8.25 0C10.321 0 12 2.6865 12 6H7.5C7.5 9.3135 5.821 12 3.75 12C1.679 12 0 9.3135 0 6H4.5C4.5 2.6865 6.179 0 8.25 0Z"
          clipRule="evenodd"
        />
      </g>
      <defs>
        <clipPath id={`${iconId}-sunodark__a`}>
          <path fill="#fff" d="M0 0H12V12H0z" />
        </clipPath>
      </defs>
    </svg>
  )
}
export { SunoDark }
export default SunoDark
