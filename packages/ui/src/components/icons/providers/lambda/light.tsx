import { type SVGProps, useId } from 'react'

import type { IconComponent } from '../../types'
const LambdaLight: IconComponent = (props: SVGProps<SVGSVGElement>) => {
  const iconId = useId()

  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 120 120" {...props}>
      <mask
        id={`${iconId}-lambdalight__a`}
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
      <g fill="#000" mask={`url(#${iconId}-lambdalight__a)`}>
        <path d="M44.8735 38.3227L56.1835 58.1413L43.5995 81.0928L51.6984 81.0862L60.0835 65.4278L69.0144 81.0928H77.2695L53.1284 38.3163L44.8735 38.3227Z" />
        <path d="M28 27V92H93V27H28ZM87.2605 86.2777H33.7395V32.7223H87.2605V86.2777Z" />
      </g>
    </svg>
  )
}
export { LambdaLight }
export default LambdaLight
