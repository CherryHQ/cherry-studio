import { type SVGProps, useId } from 'react'

import type { IconComponent } from '../../types'
const LambdaDark: IconComponent = (props: SVGProps<SVGSVGElement>) => {
  const iconId = useId()

  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="9 9 102 102" {...props}>
      <mask
        id={`${iconId}-lambdadark__a`}
        width={65}
        height={65}
        x={28}
        y={27}
        maskUnits="userSpaceOnUse"
        style={{
          maskType: 'luminance'
        }}>
        <path fill="#fff" d="M93 27H28V92H93V27Z" />
      </mask>
      <g fill="#fff" mask={`url(#${iconId}-lambdadark__a)`}>
        <path d="M44.8735 38.3226L56.1835 58.1412L43.5995 81.0927L51.6984 81.0862L60.0835 65.4277L69.0144 81.0927H77.2695L53.1284 38.3162L44.8735 38.3226Z" />
        <path d="M28 27V92H93V27H28ZM87.2605 86.2777H33.7395V32.7223H87.2605V86.2777Z" />
      </g>
    </svg>
  )
}
export { LambdaDark }
export default LambdaDark
