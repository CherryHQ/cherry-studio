import { type SVGProps, useId } from 'react'

import type { IconComponent } from '../types'
const OpenCode: IconComponent = (props: SVGProps<SVGSVGElement>) => {
  const iconId = useId()

  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="24.6 16 70.8 88" {...props}>
      <g clipPath={`url(#${iconId}-opencode__a)`}>
        <path
          fill="#000"
          fillRule="evenodd"
          d="M77.2 34.2H42.8V85.8H77.2V34.2ZM94.4 103H25.6V17H94.4V103Z"
          clipRule="evenodd"
        />
      </g>
      <defs>
        <clipPath id={`${iconId}-opencode__a`}>
          <path fill="#fff" d="M0 0H86V86H0z" transform="translate(17 17)" />
        </clipPath>
      </defs>
    </svg>
  )
}
export { OpenCode }
export default OpenCode
